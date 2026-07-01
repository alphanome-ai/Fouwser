#!/usr/bin/env python3
"""Object storage client utilities for BrowserOS build system

Provides shared storage operations used by both upload and download modules.
The active backend is selected via STORAGE_BACKEND (default "r2"):

  - "r2"    -> Cloudflare R2 / any S3-compatible store (boto3)
  - "azure" -> Azure Blob Storage (azure-storage-blob)

Historically this module was R2-only; the ``*_r2`` names are kept as the public
API for backward compatibility but now dispatch through a StorageClient.
"""

import json
from pathlib import Path
from typing import List, Optional

from ...common.env import EnvConfig
from ...common.utils import log_info, log_error, log_success, log_warning
from .base import StorageClient

# Try to import boto3 for S3/R2 (S3-compatible)
try:
    import boto3
    from botocore.config import Config

    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False


class S3StorageClient(StorageClient):
    """S3/R2 implementation of StorageClient backed by a boto3 S3 client."""

    def __init__(self, client, bucket: str):
        self._client = client
        self.bucket = bucket

    def upload_file(self, local_path: Path, key: str) -> bool:
        try:
            log_info(f"Uploading {local_path.name}...")
            self._client.upload_file(str(local_path), self.bucket, key)
            log_success(f"Uploaded: {key}")
            return True
        except Exception as e:
            log_error(f"Failed to upload {local_path.name}: {e}")
            return False

    def download_file(self, key: str, dest_path: Path) -> bool:
        try:
            log_info(f"Downloading {key}...")
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            self._client.download_file(self.bucket, key, str(dest_path))
            log_success(f"Downloaded: {dest_path.name}")
            return True
        except Exception as e:
            log_error(f"Failed to download {key}: {e}")
            return False

    def get_bytes(self, key: str) -> Optional[bytes]:
        try:
            response = self._client.get_object(Bucket=self.bucket, Key=key)
            return response["Body"].read()
        except self._client.exceptions.NoSuchKey:
            return None
        except Exception as e:
            log_error(f"Failed to read {key}: {e}")
            return None

    def copy(self, src_key: str, dest_key: str) -> bool:
        try:
            self._client.copy_object(
                Bucket=self.bucket,
                CopySource={"Bucket": self.bucket, "Key": src_key},
                Key=dest_key,
            )
            return True
        except Exception as e:
            log_error(f"Failed to copy {src_key} → {dest_key}: {e}")
            return False

    def list_prefixes(self, prefix: str, delimiter: str = "/") -> List[str]:
        prefixes: List[str] = []
        continuation_token = None
        while True:
            kwargs = {"Bucket": self.bucket, "Prefix": prefix, "Delimiter": delimiter}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            try:
                response = self._client.list_objects_v2(**kwargs)
            except Exception as e:
                log_error(f"Failed to list prefixes under {prefix}: {e}")
                break
            for cp in response.get("CommonPrefixes", []):
                prefixes.append(cp["Prefix"])
            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")
        return prefixes


def _create_s3_client(env: EnvConfig) -> Optional[StorageClient]:
    if not BOTO3_AVAILABLE:
        log_error("boto3 not installed - run: pip install boto3")
        return None
    if not env.has_r2_config():
        log_error("R2 configuration not set")
        return None
    client = boto3.client(
        "s3",
        endpoint_url=env.r2_endpoint_url,
        aws_access_key_id=env.r2_access_key_id,
        aws_secret_access_key=env.r2_secret_access_key,
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    )
    return S3StorageClient(client, env.r2_bucket)


def _create_azure_client(env: EnvConfig) -> Optional[StorageClient]:
    from .azure_backend import AzureStorageClient, AZURE_AVAILABLE

    if not AZURE_AVAILABLE:
        log_error(
            "azure-storage-blob not installed - run: pip install azure-storage-blob"
        )
        return None
    if not env.has_azure_config():
        log_error(
            "Azure configuration not set. Required env var: "
            "AZURE_STORAGE_CONNECTION_STRING"
        )
        return None
    return AzureStorageClient(env.azure_connection_string, env.azure_container)


def get_storage_client(env: Optional[EnvConfig] = None) -> Optional[StorageClient]:
    """Create a StorageClient for the configured backend (STORAGE_BACKEND)."""
    if env is None:
        env = EnvConfig()

    backend = env.storage_backend
    if backend == "azure":
        return _create_azure_client(env)
    return _create_s3_client(env)


# Backward-compatible alias (callers historically used get_r2_client)
get_r2_client = get_storage_client


def upload_file_to_r2(
    client: StorageClient,
    local_path: Path,
    r2_key: str,
    bucket: Optional[str] = None,
) -> bool:
    """Upload a single file via the storage client.

    ``bucket`` is accepted for backward compatibility but ignored; the client is
    already bound to its container/bucket.
    """
    return client.upload_file(local_path, r2_key)


def download_file_from_r2(
    client: StorageClient,
    r2_key: str,
    dest_path: Path,
    bucket: Optional[str] = None,
) -> bool:
    """Download a single file via the storage client."""
    return client.download_file(r2_key, dest_path)


def download_from_r2(
    r2_key: str,
    dest_path: Path,
    bucket: Optional[str] = None,
    env: Optional[EnvConfig] = None,
) -> bool:
    """Download a file from storage (convenience wrapper)."""
    if env is None:
        env = EnvConfig()

    client = get_storage_client(env)
    if not client:
        return False

    return client.download_file(r2_key, dest_path)


def get_release_json(
    version: str,
    platform: str,
    env: Optional[EnvConfig] = None,
) -> Optional[dict]:
    """Fetch release.json for a specific version and platform from storage."""
    if env is None:
        env = EnvConfig()

    client = get_storage_client(env)
    if not client:
        return None

    key = f"releases/{version}/{platform}/release.json"
    data = client.get_bytes(key)
    if data is None:
        log_warning(f"release.json not found: {key}")
        return None

    try:
        return json.loads(data.decode("utf-8"))
    except Exception as e:
        log_error(f"Failed to parse release.json: {e}")
        return None
