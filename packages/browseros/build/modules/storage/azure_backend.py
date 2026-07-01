#!/usr/bin/env python3
"""Azure Blob Storage backend for BrowserOS build system

Implements the StorageClient interface on top of azure-storage-blob, using a
connection string for authentication. Selected when STORAGE_BACKEND=azure.
"""

import mimetypes
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from ...common.utils import log_info, log_error, log_success
from .base import StorageClient

# Try to import the Azure SDK (optional dependency)
try:
    from azure.storage.blob import (
        BlobServiceClient,
        ContentSettings,
        generate_blob_sas,
        BlobSasPermissions,
    )
    from azure.core.exceptions import ResourceNotFoundError

    AZURE_AVAILABLE = True
except ImportError:
    AZURE_AVAILABLE = False


def _content_type_for(key: str) -> str:
    """Best-effort content type from the object key extension."""
    ctype, _ = mimetypes.guess_type(key)
    return ctype or "application/octet-stream"


def _parse_connection_string(conn_str: str) -> dict:
    """Parse an Azure storage connection string into its key/value parts."""
    parts = {}
    for segment in conn_str.split(";"):
        if "=" in segment:
            name, _, value = segment.partition("=")
            parts[name.strip()] = value.strip()
    return parts


class AzureStorageClient(StorageClient):
    """Azure Blob Storage implementation of StorageClient.

    The ``container`` plays the same role as an S3 bucket; object ``key`` values
    map directly to blob names (Azure treats ``/`` in names as virtual folders).
    """

    def __init__(self, connection_string: str, container: str):
        self._conn_parts = _parse_connection_string(connection_string)
        self.account_name = self._conn_parts.get("AccountName", "")
        self.account_key = self._conn_parts.get("AccountKey", "")
        self.container = container

        self._service = BlobServiceClient.from_connection_string(connection_string)
        self._container_client = self._service.get_container_client(container)

    def upload_file(self, local_path: Path, key: str) -> bool:
        try:
            log_info(f"Uploading {local_path.name}...")
            with open(local_path, "rb") as f:
                self._container_client.upload_blob(
                    name=key,
                    data=f,
                    overwrite=True,
                    content_settings=ContentSettings(content_type=_content_type_for(key)),
                )
            log_success(f"Uploaded: {key}")
            return True
        except Exception as e:
            log_error(f"Failed to upload {local_path.name}: {e}")
            return False

    def download_file(self, key: str, dest_path: Path) -> bool:
        try:
            log_info(f"Downloading {key}...")
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            stream = self._container_client.download_blob(key)
            with open(dest_path, "wb") as f:
                f.write(stream.readall())
            log_success(f"Downloaded: {dest_path.name}")
            return True
        except Exception as e:
            log_error(f"Failed to download {key}: {e}")
            return False

    def get_bytes(self, key: str) -> Optional[bytes]:
        try:
            return self._container_client.download_blob(key).readall()
        except ResourceNotFoundError:
            return None
        except Exception as e:
            log_error(f"Failed to read {key}: {e}")
            return None

    def copy(self, src_key: str, dest_key: str) -> bool:
        try:
            src_blob = self._container_client.get_blob_client(src_key)
            # Private containers require an authenticated source URL; mint a
            # short-lived read SAS so the service can perform a server-side copy.
            sas = generate_blob_sas(
                account_name=self.account_name,
                container_name=self.container,
                blob_name=src_key,
                account_key=self.account_key,
                permission=BlobSasPermissions(read=True),
                expiry=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            src_url = f"{src_blob.url}?{sas}"
            dest_blob = self._container_client.get_blob_client(dest_key)
            dest_blob.start_copy_from_url(src_url)
            return True
        except Exception as e:
            log_error(f"Failed to copy {src_key} → {dest_key}: {e}")
            return False

    def list_prefixes(self, prefix: str, delimiter: str = "/") -> List[str]:
        prefixes: List[str] = []
        try:
            for item in self._container_client.walk_blobs(
                name_starts_with=prefix, delimiter=delimiter
            ):
                name = getattr(item, "name", "")
                # BlobPrefix entries (virtual folders) end with the delimiter
                if name.endswith(delimiter):
                    prefixes.append(name)
        except Exception as e:
            log_error(f"Failed to list prefixes under {prefix}: {e}")
        return prefixes
