#!/bin/bash

SERVER="http://localhost:5000"
DEVICE="android-V2302A-1764910744874"

echo "🔍 APP DEBUG TEST"
echo "================="

# 1. Server status
echo "1. Server ping:"
curl -s $SERVER/ping

# 2. Check if device is registered
echo -e "\n2. Device status:"
curl -s $SERVER/admin/devices | \
  python3 -c "
import json,sys
data=json.load(sys.stdin)
for d in data['devices']:
    if d['device_id'] == '$DEVICE':
        print('✅ Device found')
        print(f'Last seen: {d[\"last_seen\"]}')
        print(f'Pending commands: {d[\"pending_commands\"]}')
        break
else:
    print('❌ Device not in registered list')
"

# 3. Send a simple test command
echo -e "\n3. Sending TEST_COMMAND:"
curl -s -X POST $SERVER/admin/send_command \
  -H "Content-Type: application/json" \
  -d "{\"device_id\":\"$DEVICE\",\"command\":\"TEST_COMMAND\"}"

# 4. Fetch commands directly (what app should do)
echo -e "\n4. Fetching commands for device:"
curl -s "$SERVER/get_commands/$DEVICE"

# 5. Update device status
echo -e "\n5. Updating device status:"
curl -s -X POST $SERVER/update_status \
  -H "Content-Type: application/json" \
  -d "{\"device_id\":\"$DEVICE\",\"status\":\"active\"}"
