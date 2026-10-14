import importlib.util,io,pathlib,tarfile,tempfile,unittest,hashlib
spec=importlib.util.spec_from_file_location('bootstrap',pathlib.Path(__file__).with_name('bootstrap.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class BootstrapTests(unittest.TestCase):
 def archive(self,root,name,link=None):
  path=root/'source.tar.gz'
  with tarfile.open(path,'w:gz') as tar:
   item=tarfile.TarInfo(name)
   if link:item.type=tarfile.SYMTYPE;item.linkname=link;tar.addfile(item)
   else:item.size=4;tar.addfile(item,io.BytesIO(b'test'))
  return path
 def test_frozen_archive_extract_and_original_directory_preserved(self):
  with tempfile.TemporaryDirectory() as path:
   root=pathlib.Path(path);archive=self.archive(root,'frozen/hello');destination=root/'tool';module.extract(archive,destination,'frozen');self.assertEqual((destination/'hello').read_text(),'test')
   with self.assertRaisesRegex(ValueError,'SOURCE_DIRECTORY_ALREADY_EXISTS'):module.extract(archive,destination,'frozen')
 def test_traversal_and_stripped_root_symlink_escape_fail_before_extract(self):
  for name,link in [('frozen/../escape',None),('frozen/bin/link','../../escape')]:
   with tempfile.TemporaryDirectory() as path:
    root=pathlib.Path(path);archive=self.archive(root,name,link)
    with self.assertRaises(ValueError):module.extract(archive,root/'tool','frozen')
    self.assertFalse((root/'tool').exists())
 def test_cached_hash_mismatch_never_downloads_or_overwrites(self):
  with tempfile.TemporaryDirectory() as path:
   target=pathlib.Path(path)/'archive';target.write_bytes(b'preserve')
   with self.assertRaisesRegex(ValueError,'CACHED_ARCHIVE_HASH_MISMATCH'):module.download('https://invalid.example/',target,'0'*64,100)
   self.assertEqual(target.read_bytes(),b'preserve')
if __name__=='__main__':unittest.main()
