const body = {
  total: 10000,
  customerEmail: 'test@example.com',
  customerPhone: '3123456789',
  reference: 'TEST123456',
  paymentMethod: 'NEQUI',
  customerName: 'Test User',
  products: [{ id: 'prod1', name: 'Test', quantity: 1, unit_price: 10000 }],
};

(async () => {
  try {
    const response = await fetch('https://shelbysebastian-1.onrender.com/api/payments/create-wompi-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    console.log('STATUS', response.status);
    console.log('BODY');
    console.log(await response.text());
  } catch (error) {
    console.error('ERROR', error);
  }
})();
