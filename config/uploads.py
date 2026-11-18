"""Enforce upload size limits while the upload is still arriving.

Django normally receives a whole uploaded file (spilling big ones to a temporary file on
disk) before any view code runs. A size check in the view would then come too late:
someone could send a 50 GB "photo" and fill the disk first.

This handler sits first in the upload pipeline and counts bytes chunk by chunk (64 KB at
a time). The moment a file, or the request as a whole, passes its limit, it stops the
upload and drops the connection, so the rest is never read and never stored.
"""
from django.core.files.uploadhandler import FileUploadHandler, StopUpload

MAX_FILE_BYTES = 10 * 1024 * 1024        # one photo
MAX_REQUEST_FILE_BYTES = 100 * 1024 * 1024  # all photos in one upload (10 x 10 MB)


class UploadSizeLimitHandler(FileUploadHandler):
    def handle_raw_input(self, input_data, META, content_length, boundary, encoding=None):
        self.request_bytes = 0
        # When the browser announces the total size up front, refuse obvious giants at once.
        if content_length and content_length > MAX_REQUEST_FILE_BYTES + 1024 * 1024:
            self.request.upload_too_large = True

    def new_file(self, *args, **kwargs):
        super().new_file(*args, **kwargs)
        self.file_bytes = 0
        if getattr(self.request, 'upload_too_large', False):
            raise StopUpload(connection_reset=True)

    def receive_data_chunk(self, raw_data, start):
        self.file_bytes += len(raw_data)
        self.request_bytes += len(raw_data)
        if self.file_bytes > MAX_FILE_BYTES or self.request_bytes > MAX_REQUEST_FILE_BYTES:
            # Views check this flag to answer "too large" instead of "no file".
            self.request.upload_too_large = True
            raise StopUpload(connection_reset=True)
        return raw_data  # pass the chunk on to Django's normal handlers

    def file_complete(self, file_size):
        return None  # let the next handler build the actual file object
