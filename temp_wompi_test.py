import json 
import urllib.request, urllib.error 
url = 'https://shelbysebastian-1.onrender.com/api/payments/create-wompi-payment' 
data = {'total':10000,'customerEmail':'test@example.com','customerPhone':'3123456789','reference':'TEST123456','paymentMethod':'NEQUI','customerName':'Test User','products':[{'id':'prod1','name':'Test','quantity':1,'unit_price':10000}]} 
body = json.dumps(data).encode('utf-8') 
req = urllib.request.Request(url, data=body, headers={'Content-Type':'application/json'}) 
try: 
    with urllib.request.urlopen(req, timeout=30) as resp: 
        print('STATUS', resp.status) 
        print(resp.read().decode('utf-8')) 
except urllib.error.HTTPError as e: 
    print('HTTP ERROR', e.code) 
    try: 
        print(e.read().decode('utf-8')) 
    except Exception as inner: 
        print('READ ERROR', inner) 
except Exception as e: 
    print('ERROR', e) 
