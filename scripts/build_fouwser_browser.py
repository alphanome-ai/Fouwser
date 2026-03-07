#!/usr/bin/env python3
"""Build Fouwser with local agent artifacts.

Features:
- Interactive prompts for missing build arguments when not set in env/.env
- Graceful Ctrl+C handling that terminates in-flight subprocesses
- Optional incremental mode that preserves Chromium out/ between runs
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
from typing import Mapping

from dotenv import load_dotenv

ACTIVE_PROCESS: subprocess.Popen | None = None
INTERRUPT_COUNT = 0


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
    if proc is None:
        return
    if proc.poll() is not None:
        return

    try:
        if os.name == "posix":
            pgid = os.getpgid(proc.pid)
            os.killpg(pgid, signal.SIGKILL if force else signal.SIGTERM)
        else:
            if force:
                proc.kill()
            else:
                proc.terminate()
    except ProcessLookupError:
        pass
    except Exception as exc:  # pragma: no cover - best-effort cleanup path
        log(f"Warning: failed to terminate subprocess cleanly: {exc}")


def _sigint_handler(signum: int, frame: object | None) -> None:  # noqa: ARG001
    global INTERRUPT_COUNT

    INTERRUPT_COUNT += 1
    if INTERRUPT_COUNT == 1:
        # log("Ctrl+C detected. Stopping current step (send Ctrl+C again to force kill)...")
        _terminate_active_process(force=False)
    else:
        # log("Second Ctrl+C detected. Force killing current step...")
        _terminate_active_process(force=True)

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
    """Run command with tracked subprocess so Ctrl+C can terminate children."""

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
        die(f"Command failed ({result.returncode}): {' '.join(shlex.quote(part) for part in cmd)}")

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
        key = key.strip()
        value = value.strip()
        if value.startswith(("'", '"')) and value.endswith(("'", '"')) and len(value) >= 2:
            value = value[1:-1]
        values[key] = value
    return values


def load_env_values(root_dir: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for path in (root_dir / ".env", root_dir / ".env.local"):
        if path.exists() and path.is_file():
            values.update(_parse_env_file(path))
    return values


def show_cli_arg_guide() -> None:
    print("\nBuild arguments:")
    specs = [
        ("CHROMIUM_SRC", "<required>", "path to Chromium src"),
        ("TARGET_ARCH", "arm64", "arm64 | x64"),
        ("TARGET_OS", "macos", "macos"),
        ("BUILD_TYPE", "release", "release | debug"),
        ("SERVER_MODE", "prod", "prod | dev"),
        ("SKIP_SIGN", "1", "1 | 0"),
        ("INCREMENTAL", "1", "1 | 0"),
        ("UV_CACHE_DIR", "/tmp/uv-cache", "any writable path"),
        ("CHROME_PACKER", "<required>", "browser binary path"),
        ("MACOS_CERTIFICATE_NAME", "<required when SKIP_SIGN=0>", "codesigning certificate name"),
        ("PROD_MACOS_NOTARIZATION_APPLE_ID", "<required when SKIP_SIGN=0>", "Apple ID email"),
        ("PROD_MACOS_NOTARIZATION_TEAM_ID", "<required when SKIP_SIGN=0>", "Apple Team ID"),
        ("PROD_MACOS_NOTARIZATION_PWD", "<required when SKIP_SIGN=0>", "app-specific password"),
    ]
    for key, default, options in specs:
        print(f"  - {key}: default={default}; options={options}")
    print()


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
        if secret:
            raw = getpass.getpass(f"{prompt}{suffix}{choice_suffix}: ")
        else:
            raw = input(f"{prompt}{suffix}{choice_suffix}: ").strip()

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
    """Resolve from process env, then .env, otherwise prompt."""

    value = os.getenv(key)
    if value is None or value == "":
        value = env_values.get(key)

    if value is None or value == "":
        value = _prompt_value(prompt=prompt, default=default, choices=choices, secret=secret)

    if choices and value not in choices:
        die(f"Invalid value for {key}: {value}. Allowed: {', '.join(sorted(choices))}")

    return value


def extension_id_from_pem(pem_path: Path) -> str:
    result = run(
        ["openssl", "pkey", "-in", str(pem_path), "-pubout", "-outform", "DER"],
        capture_output=True,
        text=False,
    )
    der = result.stdout
    if not der:
        die(f"Failed to extract public key DER: {pem_path}")
    digest = hashlib.sha256(der).hexdigest()[:32]
    return digest.translate(str.maketrans("0123456789abcdef", "abcdefghijklmnop"))


def json_get(json_file: Path, key: str) -> str:
    obj = json.loads(json_file.read_text(encoding="utf-8"))
    return str(obj[key])


def ensure_pkcs8_key(key_path: Path) -> None:
    tmp_pkcs8 = key_path.with_suffix(key_path.suffix + ".pk8.tmp")
    result = run(
        ["openssl", "pkcs8", "-topk8", "-nocrypt", "-in", str(key_path), "-out", str(tmp_pkcs8)],
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        log(f"Extension key at {key_path} is invalid; regenerating")
        run(
            ["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(key_path)]
        )
        run(["openssl", "pkcs8", "-topk8", "-nocrypt", "-in", str(key_path), "-out", str(tmp_pkcs8)])
    tmp_pkcs8.replace(key_path)


def pack_extension(src_dir: Path, key_path: Path, out_crx: Path, log_file: Path, chrome_packer: Path) -> None:
    if not key_path.is_file():
        log(f"Generating extension key: {key_path}")
        key_path.parent.mkdir(parents=True, exist_ok=True)
        run(
            ["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(key_path)]
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


def patch_chromium_files(chromium_src: Path, agent_id: str, controller_id: str) -> None:
    constants_file = chromium_src / "chrome/browser/browseros/core/browseros_constants.h"
    build_gn_file = chromium_src / "chrome/browser/browseros/bundled_extensions/BUILD.gn"

    require_file(constants_file)
    require_file(build_gn_file)

    text = constants_file.read_text(encoding="utf-8")
    text = re.sub(
        r'(kAgentV2ExtensionId\[\]\s*=\s*\n\s*")([^"]+)(";)',
        rf'\1{agent_id}\3',
        text,
        count=1,
    )
    text = re.sub(
        r'(kControllerExtensionId\[\]\s*=\s*\n\s*")([^"]+)(";)',
        rf'\1{controller_id}\3',
        text,
        count=1,
    )
    constants_file.write_text(text, encoding="utf-8")

    build_text = build_gn_file.read_text(encoding="utf-8")
    new_block = (
        '_bundled_extensions_sources = [\n'
        '  "bundled_extensions.json",\n'
        f'  "{agent_id}.crx",  # Agent V2\n'
        f'  "{controller_id}.crx",  # Controller\n'
        ']'
    )
    build_text = re.sub(
        r'_bundled_extensions_sources = \[(?:.|\n)*?\n\]',
        new_block,
        build_text,
        count=1,
    )
    build_gn_file.write_text(build_text, encoding="utf-8")


def parse_semantic_version(version_file: Path) -> str:
    vals: dict[str, str] = {}
    for raw in version_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        vals[key.strip()] = value.strip()

    maj = vals.get("BROWSEROS_MAJOR", "0")
    min_ = vals.get("BROWSEROS_MINOR", "0")
    bld = vals.get("BROWSEROS_BUILD", "0")
    patch = vals.get("BROWSEROS_PATCH", "0")

    if patch != "0":
        return f"{maj}.{min_}.{bld}.{patch}"
    if bld != "0":
        return f"{maj}.{min_}.{bld}"
    return f"{maj}.{min_}.0"


def run_main() -> None:
    root_dir = Path(__file__).resolve().parent.parent
    load_dotenv(root_dir / "packages" / "browseros" / ".env") # load env from packages/browseros/.env
    dotenv_values = load_env_values(root_dir)
    # show_cli_arg_guide()

    chromium_src = Path(
        resolve_config_value(
            key="CHROMIUM_SRC",
            env_values=dotenv_values,
            prompt="CHROMIUM_SRC path",
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
        choices={"macos"},
    )
    build_type = resolve_config_value(
        key="BUILD_TYPE",
        env_values=dotenv_values,
        prompt="BUILD_TYPE",
        default="release",
        choices={"release", "debug"},
    )
    server_mode = resolve_config_value(
        key="SERVER_MODE",
        env_values=dotenv_values,
        prompt="SERVER_MODE",
        default="prod",
        choices={"prod", "dev"},
    )
    skip_sign_raw = resolve_config_value(
        key="SKIP_SIGN",
        env_values=dotenv_values,
        prompt="SKIP_SIGN (1=skip signing, 0=sign)",
        default="1",
        choices={"0", "1"},
    )
    skip_sign = skip_sign_raw == "1"
    incremental_raw = resolve_config_value(
        key="INCREMENTAL",
        env_values=dotenv_values,
        prompt="INCREMENTAL (1=incremental, 0=full clean)",
        default="1",
        choices={"0", "1"},
    )
    incremental = incremental_raw == "1"
    uv_cache_dir = resolve_config_value(
        key="UV_CACHE_DIR",
        env_values=dotenv_values,
        prompt="UV_CACHE_DIR",
        default="/tmp/uv-cache",
    )
    chrome_packer = Path(
        resolve_config_value(
            key="CHROME_PACKER",
            env_values=dotenv_values,
            prompt="CHROME_PACKER binary path",
        )
    )

    # Persist resolved values for child commands.
    os.environ["CHROMIUM_SRC"] = str(chromium_src)
    os.environ["TARGET_ARCH"] = target_arch
    os.environ["TARGET_OS"] = target_os
    os.environ["BUILD_TYPE"] = build_type
    os.environ["SERVER_MODE"] = server_mode
    os.environ["SKIP_SIGN"] = skip_sign_raw
    os.environ["INCREMENTAL"] = incremental_raw
    os.environ["UV_CACHE_DIR"] = uv_cache_dir
    os.environ["CHROME_PACKER"] = str(chrome_packer)

    if not skip_sign:
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

    agent_monorepo = root_dir / "packages/browseros-agent"
    browseros_pkg = root_dir / "packages/browseros"
    key_dir = agent_monorepo / ".release-keys"
    work_dir = root_dir / ".tmp/custom-release"
    shim_bin_dir = work_dir / "shims"

    require_cmd("bun")
    require_cmd("uv")
    require_cmd("python3")
    require_cmd("openssl")

    if not chromium_src.is_dir():
        die(f"CHROMIUM_SRC not found: {chromium_src}")
    if not (chrome_packer.is_file() and os.access(chrome_packer, os.X_OK)):
        die(f"Chrome packer binary not found: {chrome_packer}")

    key_dir.mkdir(parents=True, exist_ok=True)
    if work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    shim_bin_dir.mkdir(parents=True, exist_ok=True)

    if server_mode == "prod" and not shutil.which("sentry-cli"):
        log("sentry-cli not found; using local no-op shim for sourcemap steps")
        shim = shim_bin_dir / "sentry-cli"
        shim.write_text("#!/usr/bin/env bash\necho \"[shim] sentry-cli $*\" >&2\nexit 0\n", encoding="utf-8")
        shim.chmod(0o755)
        os.environ["PATH"] = f"{shim_bin_dir}:{os.environ.get('PATH', '')}"

    log("Building browseros-agent artifacts")
    build_env = os.environ.copy()
    build_env.setdefault("VITE_PUBLIC_BROWSEROS_API", "https://api.browseros.com")
    build_env["GRAPHQL_SCHEMA_PATH"] = str(agent_monorepo / "apps/agent/schema/schema.graphql")

    run(["bun", "install"], cwd=agent_monorepo, env=build_env)
    run(["bun", "run", "build:agent"], cwd=agent_monorepo, env=build_env)
    run(["bun", "run", "build:ext"], cwd=agent_monorepo, env=build_env)

    env_prod = agent_monorepo / "apps/server/.env.production"
    if server_mode == "prod" and not env_prod.exists():
        log("Creating apps/server/.env.production with placeholder values (edit as needed).")
        env_prod.write_text(
            "\n".join(
                [
                    "BROWSEROS_CONFIG_URL=https://llm.browseros.com/api/browseros-server/config",
                    "CODEGEN_SERVICE_URL=https://api.browseros.com/graphql",
                    "POSTHOG_API_KEY=placeholder",
                    "SENTRY_DSN=placeholder",
                    "SENTRY_AUTH_TOKEN=placeholder",
                    "SENTRY_ORG=placeholder",
                    "SENTRY_PROJECT=placeholder",
                    "",
                ]
            ),
            encoding="utf-8",
        )

    if target_arch == "arm64":
        server_target = "darwin-arm64"
        server_bin_name = "browseros-server-darwin-arm64"
        bun_target_name = "bun-darwin-arm64"
    else:
        server_target = "darwin-x64"
        server_bin_name = "browseros-server-darwin-x64"
        bun_target_name = "bun-darwin-x64"

    run(
        ["bun", "scripts/build/server.ts", f"--mode={server_mode}", f"--target={server_target}"],
        cwd=agent_monorepo,
        env=build_env,
    )

    agent_dist = agent_monorepo / "apps/agent/dist/chrome-mv3"
    controller_dist = agent_monorepo / "apps/controller-ext/dist"
    server_dist = agent_monorepo / "dist/server"
    server_bundle_js = server_dist / "bundle/index.js"

    require_file(agent_dist / "manifest.json")
    require_file(controller_dist / "manifest.json")
    require_file(server_dist / server_bin_name)

    log("Packing custom extension CRXs")
    agent_key = key_dir / "agent.pem"
    controller_key = key_dir / "controller.pem"
    packed_agent_crx = work_dir / "agent.crx"
    packed_controller_crx = work_dir / "controller.crx"

    pack_extension(agent_dist, agent_key, packed_agent_crx, work_dir / "pack-agent.log", chrome_packer)
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

    log("Custom extension IDs")
    print(f"  agent:      {agent_id} (v{agent_version})")
    print(f"  controller: {controller_id} (v{controller_version})")

    log("Updating BrowserOS resources with custom server artifacts")
    resources_server_dir = browseros_pkg / "resources/binaries/browseros_server"
    resources_bun_dir = browseros_pkg / "resources/binaries/bun"
    resources_server_dir.mkdir(parents=True, exist_ok=True)
    resources_bun_dir.mkdir(parents=True, exist_ok=True)

    shutil.copy2(server_dist / server_bin_name, resources_server_dir / server_bin_name)
    if server_bundle_js.exists():
        shutil.copy2(server_bundle_js, resources_server_dir / "index.js")
    elif (resources_server_dir / "index.js").exists():
        log("No server JS bundle found; keeping existing resources/binaries/browseros_server/index.js")
    else:
        log("No server JS bundle found; continuing without resources/binaries/browseros_server/index.js")
        log(
            "If runtime expects Bun+index.js mode, provide that file manually in "
            f"{resources_server_dir / 'index.js'}"
        )

    (resources_server_dir / server_bin_name).chmod(0o755)

    bun_path = shutil.which("bun")
    if not bun_path:
        die("Failed to resolve bun binary path")
    shutil.copy2(Path(bun_path), resources_bun_dir / bun_target_name)
    (resources_bun_dir / bun_target_name).chmod(0o755)

    if incremental:
        prep_modules = "resources"
        log("Running Browser build incremental prep pipeline")
        log("Skipping clean/git_setup/sparkle_setup/patches (expects already-patched Chromium tree)")
    else:
        prep_modules = (
            "clean,git_setup,sparkle_setup,resources,chromium_replace,string_replaces,patches,configure"
        )
        log("Running Browser build full prep pipeline")

    uv_env = os.environ.copy()
    uv_env["UV_CACHE_DIR"] = uv_cache_dir

    run(["uv", "sync"], cwd=browseros_pkg, env=uv_env)
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
            prep_modules,
        ],
        cwd=browseros_pkg,
        env=uv_env,
    )

    log("Injecting custom bundled extensions into Chromium source")
    chromium_bundled_dir = chromium_src / "chrome/browser/browseros/bundled_extensions"
    chromium_bundled_dir.mkdir(parents=True, exist_ok=True)

    patch_chromium_files(chromium_src, agent_id, controller_id)

    shutil.copy2(packed_agent_crx, chromium_bundled_dir / f"{agent_id}.crx")
    shutil.copy2(packed_controller_crx, chromium_bundled_dir / f"{controller_id}.crx")

    bundled_json = {
        agent_id: {
            "external_crx": f"{agent_id}.crx",
            "external_version": agent_version,
        },
        controller_id: {
            "external_crx": f"{controller_id}.crx",
            "external_version": controller_version,
        },
    }
    (chromium_bundled_dir / "bundled_extensions.json").write_text(
        json.dumps(bundled_json, indent=2) + "\n",
        encoding="utf-8",
    )

    log(f"Running final {build_type} build modules")
    final_modules = "configure,compile" if skip_sign else "configure,compile,sign_macos,package_macos"

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
            final_modules,
        ],
        cwd=browseros_pkg,
        env=uv_env,
    )

    semantic_version = parse_semantic_version(browseros_pkg / "resources/BROWSEROS_VERSION")

    log("Done")
    print(f"Artifacts directory: {browseros_pkg / 'releases' / semantic_version}")
    if skip_sign:
        print("Built unsigned release binaries (compile stage only).")
    else:
        print("Built signed + packaged release artifacts.")


def main() -> None:
    install_signal_handlers()
    try:
        run_main()
    except KeyboardInterrupt:
        _terminate_active_process(force=True)
        cancel("Build interrupted by user")


if __name__ == "__main__":
    main()
