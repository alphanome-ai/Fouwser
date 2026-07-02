#!/usr/bin/env python3
"""Appcast module - Generate Sparkle appcast XML snippets"""

from ...common.context import Context
from ...common.module import CommandModule, ValidationError
from ...common.utils import log_info, log_warning
from ..storage import BOTO3_AVAILABLE
from .common import fetch_all_release_metadata, generate_appcast_item


class AppcastModule(CommandModule):
    """Generate appcast XML snippets for macOS auto-update"""

    produces = []
    requires = []
    description = "Generate Sparkle appcast XML snippets"

    def validate(self, ctx: Context) -> None:
        # boto3 is only needed for the R2/S3 backend; Azure uses azure-storage-blob.
        if ctx.env.storage_backend != "azure" and not BOTO3_AVAILABLE:
            raise ValidationError(
                "boto3 library not installed - run: pip install boto3"
            )

        if not ctx.env.has_r2_config():
            raise ValidationError("R2 configuration not set")

        if not ctx.release_version:
            raise ValidationError("--version is required")

    def execute(self, ctx: Context) -> None:
        version = ctx.release_version
        metadata = fetch_all_release_metadata(version, ctx.env)

        if "macos" not in metadata:
            log_info(f"No macOS release metadata found for version {version}")
            return

        release = metadata["macos"]
        sparkle_version = release.get("sparkle_version", "")
        build_date = release.get("build_date", "")
        artifacts = release.get("artifacts", {})

        log_info(f"\n{'='*60}")
        log_info(f"APPCAST SNIPPETS FOR v{version}")
        log_info(f"{'='*60}")

        arch_to_file = {
            "arm64": "appcast.xml",
            "x64": "appcast-x86_64.xml",
            "universal": "appcast.xml",
        }

        for arch in ["arm64", "x64", "universal"]:
            if arch not in artifacts:
                continue

            artifact = artifacts[arch]
            if "sparkle_signature" not in artifact:
                log_warning(f"{arch} artifact missing sparkle_signature")

            log_info(f"\n{arch_to_file[arch]} ({arch}):")
            print(generate_appcast_item(artifact, version, sparkle_version, build_date))

        log_info(f"\n{'='*60}")
