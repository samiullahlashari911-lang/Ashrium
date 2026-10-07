"""Stage callback contract: Python signing must match the app's TypeScript verifier."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

GPU_ROOT = Path(__file__).resolve().parents[1]
if str(GPU_ROOT) not in sys.path:
    sys.path.insert(0, str(GPU_ROOT))

import progress  # noqa: E402

SECRET = "ashrium-test-secret-0001"
# node: createHmac('sha256', SECRET).update('1700000000.').update(BODY).digest('hex')
BODY = b'{"job_id":"j","stage":"body","tenant_id":"t"}'
EXPECTED = "ed39c29ac520571617036b0f45022cc26369d3f8e4da91bd0cca269238d035ff"


class ProgressSigningTest(unittest.TestCase):
    def test_signature_matches_typescript_vector(self) -> None:
        self.assertEqual(progress.sign(BODY, "1700000000", SECRET), EXPECTED)

    def test_invalid_spec_is_a_no_op(self) -> None:
        with mock.patch.dict(os.environ, {"ASHRIUM_GPU_HMAC": SECRET}):
            with mock.patch.object(progress, "_post") as post:
                progress.make_stage_reporter(None)("body")
                progress.make_stage_reporter({"url": "ftp://x", "job_id": "j", "tenant_id": "t"})("body")
                progress.make_stage_reporter({"url": "https://a.b/p", "job_id": 1, "tenant_id": "t"})("body")
                post.assert_not_called()

    def test_reports_only_known_stages(self) -> None:
        spec = {"url": "https://www.ashrium.org/api/v1/hmr/progress", "job_id": "j", "tenant_id": "t"}
        with mock.patch.dict(os.environ, {"ASHRIUM_GPU_HMAC": SECRET}):
            with mock.patch.object(progress.threading, "Thread") as thread:
                report = progress.make_stage_reporter(spec)
                report("body")
                report("made_up")
                self.assertEqual(thread.call_count, 1)
                kwargs = thread.call_args.kwargs
                self.assertEqual(kwargs["args"][1], {"job_id": "j", "tenant_id": "t", "stage": "body"})


if __name__ == "__main__":
    unittest.main()
