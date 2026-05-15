#!/usr/bin/env python3
"""Bundled Extensions Module - Build local agent artifacts (Default) or download CDN extensions"""

import json
import os
import sys
import shutil
import subprocess
import hashlib
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, NamedTuple

import requests

from ...common.context import Context
from ...common.module import CommandModule, ValidationError
from ...common.utils import log_info, log_success, log_error


class ExtensionInfo(NamedTuple):
    """Extension metadata parsed from update manifest or local build"""

    id: str
    version: str
    codebase: str


class BundledExtensionsModule(CommandModule):
    """Build local Agent/Controller (Default) or download/bundle CDN extensions"""

    produces = ["bundled_extensions"]
    requires = []
    description = "Build local Agent/Controller (default) or download CDN extensions"

    def validate(self, context: Context) -> None:
        if not context.chromium_src or not context.chromium_src.exists():
            raise ValidationError(
                f"Chromium source directory not found: {context.chromium_src}"
            )

    def execute(self, context: Context) -> None:
        output_dir = self._get_output_dir(context)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Default to local mode unless explicitly told to use the CDN
        use_cdn = os.environ.get("USE_CDN_EXTENSIONS") == "1"

        if not use_cdn:
            log_info(
                "\n📦 [LOCAL MODE] Building and bundling local extensions (Default)..."
            )
            extensions = self._build_and_pack_local(context, output_dir)
        else:
            log_info("\n📦 [CDN MODE] Bundling extensions from CDN manifest...")
            manifest_url = context.get_extensions_manifest_url()
            extensions = self._fetch_and_parse_manifest(manifest_url)

            if not extensions:
                raise RuntimeError("No extensions found in manifest")

            log_info(f"  Found {len(extensions)} extensions in manifest")
            for ext in extensions:
                self._download_extension(ext, output_dir)

        self._generate_json(extensions, output_dir)
        self._patch_build_gn(output_dir, extensions)

        mode_str = "CDN" if use_cdn else "local"
        log_success(f"Bundled {len(extensions)} {mode_str} extensions successfully")

    def _get_output_dir(self, context: Context) -> Path:
        """Get the bundled extensions output directory in Chromium source"""
        return (
            context.chromium_src / "chrome" / "browser" / "browseros" / "bundled_extensions"
        )

    # -------------------------------------------------------------------------
    # LOCAL AGENT BUILD LOGIC (DEFAULT)
    # -------------------------------------------------------------------------

    def _build_and_pack_local(
        self, ctx: Context, output_dir: Path
    ) -> List[ExtensionInfo]:
        """Build local agent and controller extensions, pack them, and update headers."""
        chrome_packer_str = os.environ.get("CHROME_PACKER")
        if not chrome_packer_str:
            raise RuntimeError(
                "CHROME_PACKER env var is required for local agent injection."
            )
        chrome_packer = Path(chrome_packer_str)
        if not (chrome_packer.is_file() and os.access(chrome_packer, os.X_OK)):
            raise RuntimeError(f"Chrome packer not executable: {chrome_packer}")

        agent_monorepo = ctx.root_dir.parent.parent / "packages" / "browseros-agent"
        # print(f"Agent monorepo path: {agent_monorepo}")
        if not agent_monorepo.exists():
            raise RuntimeError(f"Agent monorepo not found at {agent_monorepo}")

        key_dir = agent_monorepo / ".release-keys"
        key_dir.mkdir(parents=True, exist_ok=True)
        
        agent_dist = agent_monorepo / "apps" / "agent" / "dist" / "chrome-mv3"
        controller_dist = agent_monorepo / "apps" / "controller-ext" / "dist"
        agent_key = key_dir / "agent.pem"
        controller_key = key_dir / "controller.pem"

        log_info("  Using extension release keys and packing .crx files...")
        agent_id = self._get_extension_id(agent_key)
        controller_id = self._get_extension_id(controller_key)

        agent_crx = output_dir / f"{agent_id}.crx"
        controller_crx = output_dir / f"{controller_id}.crx"

        self._pack_extension(agent_dist, agent_key, agent_crx, chrome_packer)
        self._pack_extension(
            controller_dist, controller_key, controller_crx, chrome_packer
        )

        agent_version = json.loads(
            (agent_dist / "manifest.json").read_text(encoding="utf-8")
        )["version"]
        controller_version = json.loads(
            (controller_dist / "manifest.json").read_text(encoding="utf-8")
        )["version"]

        log_info(f"  Agent ID:      {agent_id} (v{agent_version})")
        log_info(f"  Controller ID: {controller_id} (v{controller_version})")

        # Patch C++ Headers with the newly generated IDs
        self._patch_cpp_headers(ctx.chromium_src, agent_id, controller_id)

        return [
            ExtensionInfo(id=agent_id, version=agent_version, codebase="local"),
            ExtensionInfo(
                id=controller_id, version=controller_version, codebase="local"
            ),
        ]

    def _pack_extension(
        self, src_dir: Path, key_path: Path, out_crx: Path, packer: Path
    ) -> None:
        """Pack an extension directory into a .crx file using Chrome's built-in packer."""
        src_crx = src_dir.with_suffix(".crx")
        if src_crx.exists():
            src_crx.unlink()

        subprocess.run(
            [
                str(packer),
                "--no-message-box",
                f"--pack-extension={src_dir}",
                f"--pack-extension-key={key_path}",
            ],
            check=True,
            capture_output=True,
        )

        if not src_crx.exists():
            raise RuntimeError(f"Packing failed, expected {src_crx} to be created.")

        shutil.move(str(src_crx), str(out_crx))

    def _should_allow_keygen(self) -> bool:
        """Allow key generation only when explicitly requested."""
        return os.environ.get("ALLOW_EXTENSION_KEYGEN") == "1"

    def _get_extension_id(self, key_path: Path) -> str:
        """Extract the Chrome extension ID from an existing private key."""
        if not key_path.is_file():
            if not self._should_allow_keygen():
                raise RuntimeError(
                    f"Missing extension key: {key_path}. "
                    "Builds do not generate release keys by default because that changes "
                    "the extension ID and breaks OAuth redirect URIs. "
                    "Restore the existing key or set ALLOW_EXTENSION_KEYGEN=1 to generate "
                    "a new one intentionally."
                )
            log_info(f"  Generating missing extension key: {key_path.name}")
            subprocess.run(
                [
                    "openssl",
                    "genpkey",
                    "-algorithm",
                    "RSA",
                    "-pkeyopt",
                    "rsa_keygen_bits:2048",
                    "-out",
                    str(key_path),
                ],
                check=True,
            )

        # Ensure it's valid PKCS8 (Chrome requires this)
        tmp_pkcs8 = key_path.with_suffix(".pk8.tmp")
        res = subprocess.run(
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
            capture_output=True,
        )
        if res.returncode != 0:
            if not self._should_allow_keygen():
                raise RuntimeError(
                    f"Extension key is invalid or unreadable: {key_path}. "
                    "Refusing to generate a replacement automatically because that would "
                    "change the extension ID. Restore the original key or set "
                    "ALLOW_EXTENSION_KEYGEN=1 to rotate intentionally."
                )
            subprocess.run(
                [
                    "openssl",
                    "genpkey",
                    "-algorithm",
                    "RSA",
                    "-pkeyopt",
                    "rsa_keygen_bits:2048",
                    "-out",
                    str(key_path),
                ],
                check=True,
            )
            subprocess.run(
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
                check=True,
            )
        shutil.move(str(tmp_pkcs8), str(key_path))

        res = subprocess.run(
            ["openssl", "pkey", "-in", str(key_path), "-pubout", "-outform", "DER"],
            check=True,
            capture_output=True,
        )
        digest = hashlib.sha256(res.stdout).hexdigest()[:32]
        return digest.translate(str.maketrans("0123456789abcdef", "abcdefghijklmnop"))

    def _patch_cpp_headers(
        self, chromium_src: Path, agent_id: str, controller_id: str
    ) -> None:
        """Inject local extension IDs into Chromium C++ headers."""
        constants_file = (
            chromium_src / "chrome/browser/browseros/core/browseros_constants.h"
        )
        if not constants_file.exists():
            log_error(f"  Warning: Cannot patch headers, missing {constants_file}")
            return

        text = constants_file.read_text(encoding="utf-8")
        text = re.sub(
            r'(kAgentV2ExtensionId\[\]\s*=\s*\n\s*")([^"]+)(";)',
            rf"\1{agent_id}\3",
            text,
            count=1,
        )
        text = re.sub(
            r'(kControllerExtensionId\[\]\s*=\s*\n\s*")([^"]+)(";)',
            rf"\1{controller_id}\3",
            text,
            count=1,
        )
        constants_file.write_text(text, encoding="utf-8")
        log_info("  Patched browseros_constants.h with local IDs.")

    def _patch_build_gn(
        self, output_dir: Path, extensions: List[ExtensionInfo]
    ) -> None:
        """Update BUILD.gn to include all bundled .crx files."""
        build_gn_file = output_dir / "BUILD.gn"
        if not build_gn_file.exists():
            return

        crx_lines = "\n".join([f'  "{ext.id}.crx",' for ext in extensions])
        new_block = (
            "_bundled_extensions_sources = [\n"
            '  "bundled_extensions.json",\n'
            f"{crx_lines}\n"
            "]"
        )

        build_text = build_gn_file.read_text(encoding="utf-8")
        build_text = re.sub(
            r"_bundled_extensions_sources = \[(?:.|\n)*?\n\]",
            new_block,
            build_text,
            count=1,
        )
        build_gn_file.write_text(build_text, encoding="utf-8")

    # -------------------------------------------------------------------------
    # CDN / REMOTE LOGIC
    # -------------------------------------------------------------------------

    def _fetch_and_parse_manifest(self, url: str) -> List[ExtensionInfo]:
        """Fetch XML manifest and parse extension information"""
        log_info(f"  Fetching manifest: {url}")

        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
        except requests.RequestException as e:
            raise RuntimeError(f"Failed to fetch manifest: {e}")

        return self._parse_manifest_xml(response.text)

    def _parse_manifest_xml(self, xml_content: str) -> List[ExtensionInfo]:
        """Parse Google Update protocol XML manifest"""
        extensions = []
        try:
            root = ET.fromstring(xml_content)
        except ET.ParseError as e:
            raise RuntimeError(f"Failed to parse manifest XML: {e}")

        ns = {"gupdate": "http://www.google.com/update2/response"}
        apps = root.findall(".//gupdate:app", ns)
        if not apps:
            apps = root.findall(".//app")

        for app in apps:
            app_id = app.get("appid")
            if not app_id:
                continue

            updatecheck = app.find("gupdate:updatecheck", ns)
            if updatecheck is None:
                updatecheck = app.find("updatecheck")
            if updatecheck is None:
                continue

            version = updatecheck.get("version")
            codebase = updatecheck.get("codebase")

            if version and codebase:
                extensions.append(
                    ExtensionInfo(id=app_id, version=version, codebase=codebase)
                )

        return extensions

    def _download_extension(self, ext: ExtensionInfo, output_dir: Path) -> None:
        """Download a single extension .crx file"""
        dest_filename = f"{ext.id}.crx"
        dest_path = output_dir / dest_filename

        log_info(f"  Downloading {ext.id} v{ext.version}...")

        try:
            response = requests.get(ext.codebase, stream=True, timeout=60)
            response.raise_for_status()

            total_size = int(response.headers.get("content-length", 0))
            downloaded = 0

            with open(dest_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=65536):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total_size:
                        percent = downloaded / total_size * 100
                        sys.stdout.write(f"\r    {dest_filename}: {percent:.0f}%  ")
                        sys.stdout.flush()

            if total_size:
                sys.stdout.write(
                    f"\r    {dest_filename}: done ({total_size / 1024:.0f} KB)\n"
                )
            else:
                sys.stdout.write(f"\r    {dest_filename}: done\n")
            sys.stdout.flush()

        except requests.RequestException as e:
            raise RuntimeError(f"Failed to download {ext.id}: {e}")

    # -------------------------------------------------------------------------
    # COMMON LOGIC
    # -------------------------------------------------------------------------

    def _generate_json(self, extensions: List[ExtensionInfo], output_dir: Path) -> None:
        """Generate bundled_extensions.json"""
        json_path = output_dir / "bundled_extensions.json"

        data: Dict[str, Dict[str, str]] = {}
        for ext in extensions:
            data[ext.id] = {
                "external_crx": f"{ext.id}.crx",
                "external_version": ext.version,
            }

        with open(json_path, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")

        log_info(f"  Generated {json_path.name}")
