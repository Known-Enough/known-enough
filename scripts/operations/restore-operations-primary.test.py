import base64
import hashlib
import importlib.util
import io
import json
import unittest
import zipfile
from pathlib import Path
spec = importlib.util.spec_from_file_location("restore_primary", Path(__file__).with_name("restore-operations-primary.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class RecoveryTests(unittest.TestCase):
    def archive(self, source=m.OWNER_SOURCE, extra=False):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as z:
            z.writestr("api.mjs", "// synthetic test executable")
            z.writestr("configuration-private.json", json.dumps({"account":m.ACCOUNT,"region":"us-east-1","userPoolId":"us-east-1_V9OMjd0zx","participantClientId":"p","displayClientId":"d","allowedOrigin":"https://example.invalid","emailKey":"PRIVATE_TEST_KEY","cognitoDomain":"https://auth.example.invalid"}))
            z.writestr("manifest-private.json", "{}")
            z.writestr("release-private.json", "{}")
            z.writestr("lifecycle-private.json", json.dumps({"schemaVersion":1,"sourceSha":source,"signingKeyBase64":base64.b64encode(b"a"*32).decode()}))
            if extra: z.writestr("foreign.json", "private")
        data = out.getvalue()
        return data, hashlib.sha256(data).hexdigest()+"/api.zip"

    def target(self):
        return {"FunctionArn":"arn:aws:lambda:us-east-1:"+m.ACCOUNT+":function:"+m.FUNCTION,"Role":"arn:aws:iam::"+m.ACCOUNT+":role/KnownEnoughStageApiRole","Handler":"api.handler","Runtime":"nodejs24.x","RevisionId":"test","State":"Active","LastUpdateStatus":"Successful","Environment":{"Variables":{"KE14_MODEL_MODE":"DISABLED","KE14_PAID_CALLS_APPROVED":"false","NP_GROUP_TABLE_NAME":"KnownEnoughGroupsStage"}}}

    def test_real_zip_hash_source_and_private_member_validation(self):
        data,key=self.archive()
        self.assertEqual(m.verify_archive(data,key),key.split("/")[0])
        for data,key in [self.archive(source="b"*40),self.archive(extra=True),(data,"c"*64+"/api.zip")]:
            with self.assertRaises(ValueError):m.verify_archive(data,key)

    def test_wrong_target_enabled_model_or_unsettled_function_cannot_be_restored(self):
        m.verify_target(self.target())
        for field,value in [("Role","other"),("State","Pending"),("Handler","api.qaHandler")]:
            t=self.target();t[field]=value
            with self.assertRaises(ValueError):m.verify_target(t)
        t=self.target();t["Environment"]["Variables"]["KE14_MODEL_MODE"]="BEDROCK"
        with self.assertRaises(ValueError):m.verify_target(t)

    def test_recovered_private_configuration_must_still_match_the_actual_environment(self):
        data,_=self.archive();current=self.target()
        current["Environment"]["Variables"].update({"COGNITO_USER_POOL_ID":"us-east-1_V9OMjd0zx","COGNITO_PARTICIPANT_CLIENT_ID":"p","COGNITO_DISPLAY_CLIENT_ID":"d","KE13B_ALLOWED_ORIGIN":"https://example.invalid","NP_GROUP_EMAIL_KEY":"PRIVATE_TEST_KEY","NP_COGNITO_DOMAIN":"https://auth.example.invalid"})
        m.verify_runtime_binding(data,current)
        current["Environment"]["Variables"]["NP_GROUP_EMAIL_KEY"]="changed"
        with self.assertRaises(ValueError):m.verify_runtime_binding(data,current)

    def test_restoration_requires_exact_hash_and_preserved_configuration(self):
        previous=self.target();current=self.target();current["CodeSha256"]=base64.b64encode(bytes.fromhex("a"*64)).decode()
        m.verify_readback(previous,current,"a"*64)
        current["Environment"]["Variables"]["OTHER"]="changed"
        with self.assertRaises(ValueError):m.verify_readback(previous,current,"a"*64)


if __name__ == "__main__":unittest.main()
