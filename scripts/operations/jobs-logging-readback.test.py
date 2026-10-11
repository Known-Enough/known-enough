import importlib.util
import json
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location("logging_readback", Path(__file__).with_name("jobs-logging-readback.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LoggingReadbackTests(unittest.TestCase):
    def summary(self, code=0, stdout="", stderr=""):
        return module.logging_summary(code, stdout, stderr, "a" * 40)

    def test_successful_absent_configuration_including_empty_cli_output(self):
        for body in ("", "\n", "{}", '{"loggingConfig":null}'):
            self.assertEqual(self.summary(stdout=body)["result"], "PROVIDER_LOGGING_DISABLED")

    def test_enabled_unknown_or_failed_logging_does_not_prove_disabled(self):
        for body in ('{"loggingConfig":{"textDataDeliveryEnabled":true}}',
                     '{"loggingConfig":{"textDataDeliveryEnabled":0}}', "null", "not-json"):
            self.assertEqual(self.summary(stdout=body)["result"], "PROVIDER_LOGGING_UNVERIFIED_OR_ENABLED")
        self.assertEqual(self.summary(code=255)["result"], "PROVIDER_LOGGING_UNVERIFIED_OR_ENABLED")

    def test_report_never_copies_private_destinations_or_raw_errors(self):
        result = self.summary(code=255, stderr="An error occurred (AccessDeniedException) SECRET_PRIVATE_DESTINATION")
        self.assertEqual(result["code"], "AccessDeniedException")
        self.assertNotIn("SECRET", json.dumps(result))
        result = self.summary(stdout='{"loggingConfig":{"textDataDeliveryEnabled":false,"cloudWatchConfig":{"logGroupName":"PRIVATE"}}}')
        self.assertEqual(result["result"], "PROVIDER_LOGGING_DISABLED")
        self.assertNotIn("PRIVATE", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
