#!/usr/bin/env python3
"""Storage modules for R2 upload/download operations"""

from .base import StorageClient
from .r2 import (
    BOTO3_AVAILABLE,
    get_r2_client,
    get_storage_client,
    upload_file_to_r2,
    download_file_from_r2,
    download_from_r2,
    get_release_json,
)

from .upload import UploadModule
from .download import DownloadResourcesModule

__all__ = [
    # Storage utilities
    "StorageClient",
    "BOTO3_AVAILABLE",
    "get_r2_client",
    "get_storage_client",
    "upload_file_to_r2",
    "download_file_from_r2",
    "download_from_r2",
    "get_release_json",
    # Modules
    "UploadModule",
    "DownloadResourcesModule",
]
