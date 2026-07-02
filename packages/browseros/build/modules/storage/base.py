#!/usr/bin/env python3
"""Storage backend abstraction for BrowserOS build system

Defines a provider-agnostic interface so artifacts can be distributed via
different object stores (Cloudflare R2 / S3, Azure Blob Storage, ...).

The container/bucket is bound to the client at construction time, so callers
only ever deal in keys (object paths) relative to that container.
"""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import List, Optional


class StorageClient(ABC):
    """Provider-agnostic object storage client.

    Implementations wrap a concrete SDK (boto3 for S3/R2, azure-storage-blob
    for Azure) and expose the small set of operations the build/release
    pipeline actually needs.
    """

    @abstractmethod
    def upload_file(self, local_path: Path, key: str) -> bool:
        """Upload a local file to ``key`` in the container."""

    @abstractmethod
    def download_file(self, key: str, dest_path: Path) -> bool:
        """Download ``key`` from the container to ``dest_path``."""

    @abstractmethod
    def get_bytes(self, key: str) -> Optional[bytes]:
        """Return the raw bytes of ``key``, or ``None`` if it does not exist."""

    @abstractmethod
    def copy(self, src_key: str, dest_key: str) -> bool:
        """Server-side copy ``src_key`` to ``dest_key`` within the container."""

    @abstractmethod
    def list_prefixes(self, prefix: str, delimiter: str = "/") -> List[str]:
        """List immediate "sub-directory" prefixes under ``prefix``.

        Returns full prefixes including the trailing delimiter, e.g.
        ``["releases/0.31.0/", "releases/0.32.0/"]``.
        """
