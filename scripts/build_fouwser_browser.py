#!/usr/bin/env python3
"""Build Fouwser pipeline.

Features:
- Interactive prompts for missing build arguments when not set in env/.env
- Graceful Ctrl+C handling that terminates in-flight subprocesses
- Modular pipeline execution with 1/0 toggles for each step
- Custom Agent/Controller local bundling injection
"""

from __future__ import annotations

import getpass
import hashlib
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Mapping, Dict, Any

from dotenv import load_dotenv

ACTIVE_PROCESS: subprocess.Popen | None = None
INTERRUPT_COUNT = 0

# Ordered
AVAILABLE_MODULES = {
    "clean": "Clean build artifacts and reset git state",
    "git_setup": "Checkout Chromium version and sync dependencies",
    "sparkle_setup": "Download and setup Sparkle framework (macOS only)",
    # "download_resources": "Download resources from Cloudflare R2",
    "resources": "Copy resources (icons, extensions) to Chromium",
    "bundled_extensions": "Bundle extensions (local/CDN)",
    "chromium_replace": "Replace Chromium source files with custom versions",
    "string_replaces": "Apply branding string replacements in Chromium",
    "patches": "Apply Fouwser patches to Chromium",
    "configure": "Configure build with GN",
    # "series_patches": "Apply series-based patches (GNU Quilt format)",
    "compile": "Build Fouwser using autoninja",
    # "universal_build": "Build, sign, package, and upload universal binary (arm64 + x64) for macOS",
    # "sign_linux": "Linux code signing (no-op)",
    "sign_macos": "Sign and notarize macOS application",
    "sign_windows": "Sign Windows binaries and create signed installer",
    "sparkle_sign": "Sign DMG files with Sparkle Ed25519 key for auto-update",
    "package_linux": "Create AppImage and .deb packages for Linux",
    "package_macos": "Create DMG package for macOS",
    "package_windows": "Create Windows installer and portable ZIP",
    # "upload": "Upload build artifacts to Cloudflare R2",
}

# Modules that must run BEFORE injecting local extensions into Chromium source
PREP_MODULE_LIST = {
    "clean",
    "git_setup",
    "sparkle_setup",
    "configure",
    # "download_resources",
    # "series_patches",
    "patches",
    "chromium_replace",
    "string_replaces",
    "resources",
    "bundled_extensions",
}

# Modules that must run AFTER injecting local extensions into Chromium source
BUILD_MODULE_LIST = {
    "compile",
    # "universal_build",
    "sign_linux",
    "sign_macos",
    "sign_windows",
    "sparkle_sign",
    "package_linux",
    "package_macos",
    "package_windows",
    # "upload",
}

DEFAULT_ON_MODULES = {
    # "series_patches",
    # "patches",
    # "chromium_replace",
    # "string_replaces",
    "bundled_extensions",
    "resources",
    "configure",
    "compile",
    # "sign_macos",
    # "package_macos",
}


def log(message: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"\n[{ts}] {message}")


def die(message: str) -> None:
    print(f"\n[ERROR] {message}", file=sys.stderr)
    raise SystemExit(1)


def cancel(message: str) -> None:
    print(f"\n[CANCELLED] {message}", file=sys.stderr)
    raise SystemExit(130)


def _terminate_active_process(*, force: bool) -> None:
    global ACTIVE_PROCESS
    proc = ACTIVE_PROCESS
    if proc is None or proc.poll() is not None:
        return

    try:
        if os.name == "posix":
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL if force else signal.SIGTERM)
        else:
            proc.kill() if force else proc.terminate()
    except ProcessLookupError:
        pass
    except Exception as exc:
        log(f"Warning: failed to terminate subprocess cleanly: {exc}")


def _sigint_handler(signum: int, frame: object | None) -> None:
    global INTERRUPT_COUNT
    INTERRUPT_COUNT += 1
    _terminate_active_process(force=INTERRUPT_COUNT > 1)
    raise KeyboardInterrupt


def install_signal_handlers() -> None:
    signal.signal(signal.SIGINT, _sigint_handler)


def run(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    env: Mapping[str, str] | None = None,
    capture_output: bool = False,
    check: bool = True,
    text: bool = True,
) -> subprocess.CompletedProcess[str] | subprocess.CompletedProcess[bytes]:
    global ACTIVE_PROCESS

    popen_kwargs: dict[str, object] = {
        "cwd": str(cwd) if cwd else None,
        "env": dict(env) if env else None,
        "text": text,
        "stdout": subprocess.PIPE if capture_output else None,
        "stderr": subprocess.PIPE if capture_output else None,
    }
    if os.name == "posix":
        popen_kwargs["start_new_session"] = True

    proc = subprocess.Popen(cmd, **popen_kwargs)  # type: ignore[arg-type]
    ACTIVE_PROCESS = proc

    try:
        stdout, stderr = proc.communicate()
    except KeyboardInterrupt:
        _terminate_active_process(force=False)
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            _terminate_active_process(force=True)
            proc.wait(timeout=3)
        raise
    finally:
        ACTIVE_PROCESS = None

    result = subprocess.CompletedProcess(cmd, proc.returncode, stdout, stderr)

    if check and result.returncode != 0:
        if capture_output:
            if result.stdout:
                print(result.stdout)
            if result.stderr:
                print(result.stderr, file=sys.stderr)
        die(
            f"Command failed ({result.returncode}): {' '.join(shlex.quote(part) for part in cmd)}"
        )

    return result


def require_cmd(name: str) -> None:
    if not shutil.which(name):
        die(f"Missing required command: {name}")


def require_file(path: Path) -> None:
    if not path.is_file():
        die(f"Missing required file: {path}")


def _parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if (
            value.startswith(("'", '"'))
            and value.endswith(("'", '"'))
            and len(value) >= 2
        ):
            value = value[1:-1]
        values[key] = value
    return values


def load_env_values(root_dir: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for path in (root_dir / ".env", root_dir / ".env.local"):
        if path.exists() and path.is_file():
            values.update(_parse_env_file(path))
    return values


def _prompt_value(
    *,
    prompt: str,
    default: str | None,
    choices: set[str] | None = None,
    secret: bool = False,
) -> str:
    if not sys.stdin.isatty():
        if default is not None:
            return default
        die(f"{prompt} is required in non-interactive mode")

    while True:
        suffix = f" [{default}]" if default is not None else " [required]"
        choice_suffix = f" (options: {', '.join(sorted(choices))})" if choices else ""
        raw = (
            getpass.getpass(f"{prompt}{suffix}{choice_suffix}: ")
            if secret
            else input(f"{prompt}{suffix}{choice_suffix}: ").strip()
        )
        value = raw if raw else (default or "")
        if not value:
            print("Value is required.")
            continue
        if choices and value not in choices:
            print(f"Choose one of: {', '.join(sorted(choices))}")
            continue
        return value


def resolve_config_value(
    *,
    key: str,
    env_values: Mapping[str, str],
    prompt: str,
    default: str | None = None,
    choices: set[str] | None = None,
    secret: bool = False,
) -> str:
    value = os.getenv(key)
    if value is None or value == "":
        value = env_values.get(key)
    if value is None or value == "":
        value = _prompt_value(
            prompt=prompt, default=default, choices=choices, secret=secret
        )
    if choices and value not in choices:
        die(f"Invalid value for {key}: {value}. Allowed: {', '.join(sorted(choices))}")
    return value


# --- Extension Bundling Logic ---


def extension_id_from_pem(pem_path: Path) -> str:
    result = run(
        ["openssl", "pkey", "-in", str(pem_path), "-pubout", "-outform", "DER"],
        capture_output=True,
        text=False,
    )
    if not result.stdout:
        die(f"Failed to extract public key DER: {pem_path}")
    digest = hashlib.sha256(result.stdout).hexdigest()[:32]
    return digest.translate(str.maketrans("0123456789abcdef", "abcdefghijklmnop"))


def json_get(json_file: Path, key: str) -> str:
    obj = json.loads(json_file.read_text(encoding="utf-8"))
    return str(obj[key])


def ensure_pkcs8_key(key_path: Path) -> None:
    tmp_pkcs8 = key_path.with_suffix(key_path.suffix + ".pk8.tmp")
    result = run(
        [
            "openssl",
            "pkcs8",
            "-topk8",
            "-nocrypt",
            "-in",
            str(key_path),
            "-out",
            str(tmp_pkcs8),
        ],
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        log(f"Extension key at {key_path} is invalid; regenerating")
        run(
            [
                "openssl",
                "genpkey",
                "-algorithm",
                "RSA",
                "-pkeyopt",
                "rsa_keygen_bits:2048",
                "-out",
                str(key_path),
            ]
        )
        run(
            [
                "openssl",
                "pkcs8",
                "-topk8",
                "-nocrypt",
                "-in",
                str(key_path),
                "-out",
                str(tmp_pkcs8),
            ]
        )
    tmp_pkcs8.replace(key_path)


def pack_extension(
    src_dir: Path, key_path: Path, out_crx: Path, log_file: Path, chrome_packer: Path
) -> None:
    if not key_path.is_file():
        log(f"Generating extension key: {key_path}")
        key_path.parent.mkdir(parents=True, exist_ok=True)
        run(
            [
                "openssl",
                "genpkey",
                "-algorithm",
                "RSA",
                "-pkeyopt",
                "rsa_keygen_bits:2048",
                "-out",
                str(key_path),
            ]
        )

    ensure_pkcs8_key(key_path)
    src_crx = Path(f"{src_dir}.crx")
    if src_crx.exists():
        src_crx.unlink()

    result = run(
        [
            str(chrome_packer),
            "--no-message-box",
            f"--pack-extension={src_dir}",
            f"--pack-extension-key={key_path}",
        ],
        capture_output=True,
        check=False,
    )
    log_file.write_text((result.stdout or "") + (result.stderr or ""), encoding="utf-8")

    if result.returncode != 0:
        print(log_file.read_text(encoding="utf-8"), file=sys.stderr)
        die(f"Failed to pack extension: {src_dir}")

    require_file(src_crx)
    out_crx.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src_crx), str(out_crx))


def build_local_agent_artifacts(
    root_dir: Path, target_arch: str, server_mode: str, chrome_packer: Path
) -> Dict[str, Any]:
    log("Building fouwser-agent artifacts...")
    agent_monorepo = root_dir / "packages/browseros-agent"
    browseros_pkg = root_dir / "packages/browseros"
    key_dir = agent_monorepo / ".release-keys"
    work_dir = root_dir / ".tmp/custom-release"
    shim_bin_dir = work_dir / "shims"

    key_dir.mkdir(parents=True, exist_ok=True)
    if work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    shim_bin_dir.mkdir(parents=True, exist_ok=True)

    build_env = os.environ.copy()
    build_env.setdefault("VITE_PUBLIC_BROWSEROS_API", "https://api.fouwser.com")
    build_env["GRAPHQL_SCHEMA_PATH"] = str(
        agent_monorepo / "apps/agent/schema/schema.graphql"
    )

    if server_mode == "prod" and not shutil.which("sentry-cli"):
        log("sentry-cli not found; using local no-op shim for sourcemap steps")
        shim = shim_bin_dir / "sentry-cli"
        shim.write_text(
            '#!/usr/bin/env bash\necho "[shim] sentry-cli $*" >&2\nexit 0\n',
            encoding="utf-8",
        )
        shim.chmod(0o755)
        build_env["PATH"] = f"{shim_bin_dir}:{build_env.get('PATH', '')}"

    run(["bun", "install"], cwd=agent_monorepo, env=build_env)
    run(["bun", "run", "build:agent"], cwd=agent_monorepo, env=build_env)
    run(["bun", "run", "build:ext"], cwd=agent_monorepo, env=build_env)

    if server_mode == "prod":
        server_env_path = agent_monorepo / "apps/server/.env.production"
    else:
        server_env_path = agent_monorepo / "apps/server/.env.development"
    if not server_env_path.exists():
        die(f"Missing required server env file: {server_env_path}")
    build_env.update(_parse_env_file(server_env_path))

    server_target = f"darwin-{target_arch}"
    server_bin_name = f"browseros-server-{server_target}"
    bun_target_name = f"bun-{server_target}"

    run(
        [
            "bun",
            "scripts/build/server.ts",
            f"--mode={server_mode}",
            f"--target={server_target}",
        ],
        cwd=agent_monorepo,
        env=build_env,
    )

    agent_dist = agent_monorepo / "apps/agent/dist/chrome-mv3"
    controller_dist = agent_monorepo / "apps/controller-ext/dist"
    server_dist = agent_monorepo / "dist/server"
    server_bundle_js = server_dist / "sourcemaps/index.js"

    require_file(agent_dist / "manifest.json")
    require_file(controller_dist / "manifest.json")
    require_file(server_dist / server_bin_name)

    log("Packing custom extension CRXs...")
    agent_key, controller_key = key_dir / "agent.pem", key_dir / "controller.pem"
    packed_agent_crx, packed_controller_crx = (
        work_dir / "agent.crx",
        work_dir / "controller.crx",
    )

    pack_extension(
        agent_dist,
        agent_key,
        packed_agent_crx,
        work_dir / "pack-agent.log",
        chrome_packer,
    )
    pack_extension(
        controller_dist,
        controller_key,
        packed_controller_crx,
        work_dir / "pack-controller.log",
        chrome_packer,
    )

    agent_id = extension_id_from_pem(agent_key)
    controller_id = extension_id_from_pem(controller_key)
    agent_version = json_get(agent_dist / "manifest.json", "version")
    controller_version = json_get(controller_dist / "manifest.json", "version")

    log(
        f"Custom IDs -> agent: {agent_id} (v{agent_version}), controller: {controller_id} (v{controller_version})"
    )

    log("Updating Fouwser resources with custom server artifacts...")
    resources_server_dir = browseros_pkg / "resources/binaries/browseros_server"
    resources_bun_dir = browseros_pkg / "resources/binaries/bun"
    resources_server_dir.mkdir(parents=True, exist_ok=True)
    resources_bun_dir.mkdir(parents=True, exist_ok=True)

    shutil.copy2(server_dist / server_bin_name, resources_server_dir / server_bin_name)
    require_file(server_bundle_js)
    shutil.copy2(server_bundle_js, resources_server_dir / "index.js")
    (resources_server_dir / server_bin_name).chmod(0o755)

    bun_path = shutil.which("bun")
    if not bun_path:
        die("Failed to resolve bun binary path")
    shutil.copy2(Path(bun_path), resources_bun_dir / bun_target_name)
    (resources_bun_dir / bun_target_name).chmod(0o755)

    return {
        "agent_id": agent_id,
        "controller_id": controller_id,
        "agent_version": agent_version,
        "controller_version": controller_version,
        "packed_agent_crx": packed_agent_crx,
        "packed_controller_crx": packed_controller_crx,
    }


def inject_agent_into_chromium(chromium_src: Path, info: Dict[str, Any]) -> None:
    log("Injecting custom bundled extensions into Chromium source...")
    constants_file = (
        chromium_src / "chrome/browser/browseros/core/browseros_constants.h"
    )
    build_gn_file = (
        chromium_src / "chrome/browser/browseros/bundled_extensions/BUILD.gn"
    )
    chromium_bundled_dir = chromium_src / "chrome/browser/browseros/bundled_extensions"
    chromium_bundled_dir.mkdir(parents=True, exist_ok=True)

    require_file(constants_file)
    require_file(build_gn_file)

    # Patch Headers
    text = constants_file.read_text(encoding="utf-8")
    text = re.sub(
        r'(kAgentV2ExtensionId\[\]\s*=\s*\n\s*")([^"]+)(";)',
        rf"\1{info['agent_id']}\3",
        text,
        count=1,
    )
    text = re.sub(
        r'(kControllerExtensionId\[\]\s*=\s*\n\s*")([^"]+)(";)',
        rf"\1{info['controller_id']}\3",
        text,
        count=1,
    )
    constants_file.write_text(text, encoding="utf-8")

    # Patch BUILD.gn
    build_text = build_gn_file.read_text(encoding="utf-8")
    new_block = (
        "_bundled_extensions_sources = [\n"
        '  "bundled_extensions.json",\n'
        f'  "{info["agent_id"]}.crx",  # Agent V2\n'
        f'  "{info["controller_id"]}.crx",  # Controller\n'
        "]"
    )
    build_text = re.sub(
        r"_bundled_extensions_sources = \[(?:.|\n)*?\n\]",
        new_block,
        build_text,
        count=1,
    )
    build_gn_file.write_text(build_text, encoding="utf-8")

    # Copy CRXs
    shutil.copy2(
        info["packed_agent_crx"], chromium_bundled_dir / f"{info['agent_id']}.crx"
    )
    shutil.copy2(
        info["packed_controller_crx"],
        chromium_bundled_dir / f"{info['controller_id']}.crx",
    )

    # Update bundled_extensions.json safely so we don't overwrite CDN extensions
    json_path = chromium_bundled_dir / "bundled_extensions.json"
    bundled_json = {}
    if json_path.exists():
        try:
            bundled_json = json.loads(json_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass

    bundled_json[info["agent_id"]] = {
        "external_crx": f"{info['agent_id']}.crx",
        "external_version": info["agent_version"],
    }
    bundled_json[info["controller_id"]] = {
        "external_crx": f"{info['controller_id']}.crx",
        "external_version": info["controller_version"],
    }

    json_path.write_text(json.dumps(bundled_json, indent=2) + "\n", encoding="utf-8")


def run_main() -> None:
    root_dir = Path(__file__).resolve().parent.parent
    load_dotenv(root_dir / "packages" / "browseros" / ".env")
    dotenv_values = load_env_values(root_dir)

    chromium_src = Path(
        resolve_config_value(
            key="CHROMIUM_SRC", env_values=dotenv_values, prompt="\nCHROMIUM_SRC path"
        )
    )
    target_arch = resolve_config_value(
        key="TARGET_ARCH",
        env_values=dotenv_values,
        prompt="TARGET_ARCH",
        default="arm64",
        choices={"arm64", "x64"},
    )
    target_os = resolve_config_value(
        key="TARGET_OS",
        env_values=dotenv_values,
        prompt="TARGET_OS",
        default="macos",
        choices={"macos", "linux", "windows"},
    )
    build_type = resolve_config_value(
        key="BUILD_TYPE",
        env_values=dotenv_values,
        prompt="BUILD_TYPE",
        default="debug",
        choices={"release", "debug"},
    )

    inject_local_agent = resolve_config_value(
        key="INJECT_LOCAL_AGENT",
        env_values=dotenv_values,
        prompt="INJECT_LOCAL_AGENT (Build and inject custom Agent/Controller extensions?)",
        default="1",
        choices={"0", "1"},
    )

    server_mode = "prod"
    chrome_packer = None
    if inject_local_agent == "1":
        require_cmd("bun")
        require_cmd("openssl")
        server_mode = resolve_config_value(
            key="SERVER_MODE",
            env_values=dotenv_values,
            prompt="SERVER_MODE",
            default="prod",
            choices={"prod", "dev"},
        )
        chrome_packer = Path(
            resolve_config_value(
                key="CHROME_PACKER",
                env_values=dotenv_values,
                prompt="CHROME_PACKER binary path",
            )
        )
        if not (chrome_packer.is_file() and os.access(chrome_packer, os.X_OK)):
            die(f"Chrome packer binary not found or not executable: {chrome_packer}")

    print(
        "\nSelect modules to execute (1 = Yes, 0 = No)."
    )
    selected_modules = []

    for mod, desc in AVAILABLE_MODULES.items():
        env_key = f"MODULE_{mod.upper()}"
        default_val = "1" if mod in DEFAULT_ON_MODULES else "0"
        choice = resolve_config_value(
            key=env_key,
            env_values=dotenv_values,
            prompt=f"  [{mod}] {desc}",
            default=default_val,
            choices={"0", "1"},
        )
        if choice == "1":
            selected_modules.append(mod)

    if not selected_modules and inject_local_agent == "0":
        die("No modules or injections selected. Aborting build.")

    # Persist resolved values
    os.environ["CHROMIUM_SRC"] = str(chromium_src)
    os.environ["TARGET_ARCH"] = target_arch
    os.environ["TARGET_OS"] = target_os
    os.environ["BUILD_TYPE"] = build_type
    os.environ["MODULES"] = ",".join(selected_modules)
    if inject_local_agent == "1":
        os.environ["SERVER_MODE"] = server_mode
        os.environ["CHROME_PACKER"] = str(chrome_packer)

    # Conditionally load Apple Dev credentials if signing is requested
    if any(m.startswith("sign_") for m in selected_modules):
        os.environ["MACOS_CERTIFICATE_NAME"] = resolve_config_value(
            key="MACOS_CERTIFICATE_NAME",
            env_values=dotenv_values,
            prompt="MACOS_CERTIFICATE_NAME",
        )
        os.environ["PROD_MACOS_NOTARIZATION_APPLE_ID"] = resolve_config_value(
            key="PROD_MACOS_NOTARIZATION_APPLE_ID",
            env_values=dotenv_values,
            prompt="PROD_MACOS_NOTARIZATION_APPLE_ID",
        )
        os.environ["PROD_MACOS_NOTARIZATION_TEAM_ID"] = resolve_config_value(
            key="PROD_MACOS_NOTARIZATION_TEAM_ID",
            env_values=dotenv_values,
            prompt="PROD_MACOS_NOTARIZATION_TEAM_ID",
        )
        os.environ["PROD_MACOS_NOTARIZATION_PWD"] = resolve_config_value(
            key="PROD_MACOS_NOTARIZATION_PWD",
            env_values=dotenv_values,
            prompt="PROD_MACOS_NOTARIZATION_PWD",
            secret=True,
        )

    require_cmd("uv")
    if not chromium_src.is_dir():
        die(f"CHROMIUM_SRC not found: {chromium_src}")

    browseros_pkg = root_dir / "packages/browseros"
    uv_env = os.environ.copy()

    log("Syncing uv dependencies...")
    run(["uv", "sync"], cwd=browseros_pkg, env=uv_env)

    # --- Phase A: Build Local Artifacts (before 'resources' module copies them) ---
    agent_info = None
    if inject_local_agent == "1":
        agent_info = build_local_agent_artifacts(
            root_dir, target_arch, server_mode, chrome_packer
        )

    # --- Phase B: Run Prep Modules (e.g., clean, git_setup, resources) ---
    prep_mods = [m for m in selected_modules if m in PREP_MODULE_LIST]
    if prep_mods:
        prep_str = ",".join(prep_mods)
        log(f"Running Prep modules: {prep_str}")
        run(
            [
                "uv",
                "run",
                "browseros",
                "build",
                "--chromium-src",
                str(chromium_src),
                "--build-type",
                build_type,
                "--arch",
                target_arch,
                "--modules",
                prep_str,
            ],
            cwd=browseros_pkg,
            env=uv_env,
        )

    # --- Phase C: Patch Chromium Source with Extensions (after prep, before configure) ---
    if inject_local_agent == "1" and agent_info:
        inject_agent_into_chromium(chromium_src, agent_info)

    # --- Phase D: Run Build Modules (e.g., configure, compile, sign) ---
    build_mods = [m for m in selected_modules if m in BUILD_MODULE_LIST]
    if build_mods:
        build_str = ",".join(build_mods)
        log(f"Running Build modules: {build_str}")
        run(
            [
                "uv",
                "run",
                "browseros",
                "build",
                "--chromium-src",
                str(chromium_src),
                "--build-type",
                build_type,
                "--arch",
                target_arch,
                "--modules",
                build_str,
            ],
            cwd=browseros_pkg,
            env=uv_env,
        )

    log("Pipeline execution complete.")


def main() -> None:
    install_signal_handlers()
    try:
        run_main()
    except KeyboardInterrupt:
        _terminate_active_process(force=True)
        cancel("Build interrupted by user")


if __name__ == "__main__":
    main()
