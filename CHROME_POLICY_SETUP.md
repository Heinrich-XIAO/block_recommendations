Extension ID: dgiopelblkcgmobjhbfpcdecdenihlcb

To force-install this extension so users cannot disable it, configure ExtensionInstallForcelist policy on each platform:

## Windows (Registry)
Create registry key:
```
HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist
```

Add String value:
- Name: 1 (or next available number)
- Value: dgiopelblkcgmobjhbfpcdecdenihlcb;https://clients2.google.com/service/update2/crx

For 32-bit Chrome on 64-bit Windows, also add to:
```
HKEY_LOCAL_MACHINE\SOFTWARE\Wow6432Node\Policies\Google\Chrome\ExtensionInstallForcelist
```

## macOS
Create file: `/Library/Managed Preferences/com.google.Chrome.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>ExtensionInstallForcelist</key>
  <array>
    <string>dgiopelblkcgmobjhbfpcdecdenihlcb;https://clients2.google.com/service/update2/crx</string>
  </array>
</dict>
</plist>
```

Set permissions:
```bash
sudo chown root:wheel /Library/Managed\ Preferences/com.google.Chrome.plist
sudo chmod 644 /Library/Managed\ Preferences/com.google.Chrome.plist
```

## Linux
Create file: `/etc/opt/chrome/policies/managed/extension_policy.json`

```json
{
  "ExtensionInstallForcelist": [
    "dgiopelblkcgmobjhbfpcdecdenihlcb;https://clients2.google.com/service/update2/crx"
  ]
}
```

For Chromium: `/etc/chromium/policies/managed/extension_policy.json`

## Verification
1. Visit: chrome://policy
2. Check "ExtensionInstallForcelist" is listed
3. Extension will be automatically installed and locked
4. Users cannot disable or remove it from chrome://extensions

## Note
This extension must be published to the Chrome Web Store for automatic updates. 
For local testing without publishing, users must manually install the unpacked extension first.
