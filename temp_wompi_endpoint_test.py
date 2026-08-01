import json
import urllib.request
import urllib.error

url = 'https://shelbysebastian-1.onrender.com/api/payments/create-wompi-payment'
data = {
    'total': 10000,
    'customerEmail': 'test@example.com',
    'customerPhone': '3123456789',
    'reference': 'TEST123456',
    'paymentMethod': 'NEQUI',
    'customerName': 'Test User',
    'products': [{'id': 'prod1', 'name': 'Test', 'quantity': 1, 'unit_price': 10000}],
}
body = json.dumps(data).encode('utf-8')
request = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})

try:
    with urllib.request.urlopen(request, timeout=30) as response:
        print('STATUS', response.status)
        print('RESPONSE_BODY')
        print(response.read().decode('utf-8'))
except urllib.error.HTTPError as error:
    print('HTTP ERROR', error.code)
    print('RESPONSE_BODY')
    print(error.read().decode('utf-8'))
except Exception as error:
    print('ERROR', error)
