import zipfile
import re

APK = '/home/z/my-project/download/ROBIN-AI.apk'

z = zipfile.ZipFile(APK)
names = z.namelist()
print('total entries:', len(names))

# 1. Essential APK parts
required = ['AndroidManifest.xml', 'classes.dex', 'resources.arsc']
for r in required:
    print(f"  {'OK ' if r in names else 'MISSING'} {r}")

icons = [n for n in names if n.startswith('res/') and 'ic_launcher' in n]
print('launcher icons:', len(icons))

# 2. Signature files (v1: META-INF)
sig = [n for n in names if n.startswith('META-INF/') and (n.endswith('.RSA') or n.endswith('.SF') or n.endswith('.MF'))]
print('v1 signature files:', sig)

# 3. CRC integrity check of every entry
bad = z.testzip()
print('zip integrity:', 'FAILED at ' + bad if bad else 'all entries OK')

# 4. Find the server URL baked into the app
target = None
for n in names:
    if n == 'resources.arsc' or n.startswith('res/'):
        continue
    data = z.read(n)
    m = re.search(rb'preview-chat-[a-z0-9\-]+\.space-z\.ai', data)
    if m:
        target = m.group(0).decode()
        print(f'URL found in {n}: https://{target}')
        break
if not target:
    # also check resources.arsc (string resources live there)
    data = z.read('resources.arsc')
    m = re.search(rb'preview-chat-[a-z0-9\-]+\.space-z\.ai', data)
    if m:
        target = m.group(0).decode()
        print(f'URL found in resources.arsc: https://{target}')

# 5. Permissions from the binary manifest (string scan)
mf = z.read('AndroidManifest.xml')
perms = set(re.findall(rb'android\.permission\.([A-Z_]+)', mf))
print('permissions:', ', '.join(sorted(p.decode() for p in perms)) or 'none found via scan')
