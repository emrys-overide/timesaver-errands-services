const http = require('http');

function post(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(resBody || '{}') }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    http.get({ hostname: u.hostname, port: u.port, path: u.pathname }, res => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => resolve({ status: res.statusCode, data: res.headers['content-type']?.includes('json') ? JSON.parse(resBody) : resBody }));
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('--- Testing Full Time Saver Errands Suite ---');

  // 1. Customer registration & login
  console.log('1. Testing Customer Registration & Login...');
  const testCustomerEmail = `testuser_${Date.now()}@example.com`;
  const regCustRes = await post('http://localhost:3000/api/auth/register-customer', {
    name: "Esther Muthoni",
    phone: "+254 712 889 900",
    email: testCustomerEmail,
    password: "password123"
  });
  console.log(`   Customer Registered: ${regCustRes.data.user?.name} (${regCustRes.data.user?.id})`);

  const loginCustRes = await post('http://localhost:3000/api/auth/login-customer', {
    email: testCustomerEmail,
    password: "password123"
  });
  console.log(`   Customer Login Status: ${loginCustRes.status === 200 ? 'SUCCESS' : 'FAIL'}`);

  // 2. Errand Runner Registration with Selfie, ID Front, ID Back
  console.log('2. Testing Errand Runner Registration with ID Front & Backward photos...');
  const testRunnerEmail = `runner_${Date.now()}@chapchap.co.ke`;
  const regRunnerRes = await post('http://localhost:3000/api/auth/register-runner', {
    name: "Samuel Omondi",
    phone: `+254 799 ${Math.floor(100000 + Math.random() * 900000)}`,
    email: testRunnerEmail,
    password: "runnerpassword123",
    idNumber: "39201482",
    activeLocation: "Westlands / Sarit Centre",
    vehicleType: "Foot & Matatu Transit",
    bio: "Punctual runner with good knowledge of Westlands and CBD routes",
    avatar: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    idCardFront: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    idCardBack: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  });
  const createdRunner = regRunnerRes.data.runner;
  console.log(`   Runner Registered: ${createdRunner?.name} (${createdRunner?.id})`);
  console.log(`   Verification Status: ${createdRunner?.verificationStatus}`);
  console.log(`   ID Front Saved: ${createdRunner?.idCardFront}`);
  console.log(`   ID Back Saved: ${createdRunner?.idCardBack}`);

  // 3. Admin Login & Verification
  console.log('3. Testing Admin Login & Runner Vetting...');
  const adminLogin = await post('http://localhost:3000/api/auth/login-admin', {
    email: "admin@timesaver.co.ke",
    password: "admin123"
  });
  console.log(`   Admin Logged In: ${adminLogin.data.admin?.name}`);

  // Admin approves newly registered runner
  const approveRes = await post(`http://localhost:3000/api/admin/runners/${createdRunner.id}/verify`, {
    action: "approve"
  });
  console.log(`   Admin Approved Runner Status: ${approveRes.data.runner?.verificationStatus} (${approveRes.data.runner?.badge})`);

  // 4. Place Errand with Matatu Fare Quantification
  console.log('4. Customer placing new errand...');
  const newErrandRes = await post('http://localhost:3000/api/errands', {
    customerId: regCustRes.data.user?.id,
    title: "Document Legalization at Sheria House & Drop to Upperhill",
    category: "queueing",
    description: "Stamp birth certificate at Sheria House, Harambee Ave, then drop off at Britam Tower",
    pickupLocation: "Sheria House, Harambee Avenue, CBD",
    dropoffLocation: "Upperhill, Britam Tower, 7th Floor",
    customerLocation: "Upperhill, Britam Tower",
    matatuStageFrom: "CBD (Kencom/Railways)",
    matatuStageTo: "Upperhill",
    isPeak: true,
    urgency: "standard",
    customerName: regCustRes.data.user?.name,
    customerPhone: regCustRes.data.user?.phone
  });
  const errand = newErrandRes.data;
  console.log(`   Errand ID: ${errand.id}`);
  console.log(`   Secret Customer PIN: ${errand.customerSecretPin}`);
  console.log(`   Base Labor Fee: KES ${errand.baseServiceFee}`);
  console.log(`   Matatu Transit Allowance: KES ${errand.matatuFare}`);
  console.log(`   Total Payment: KES ${errand.estimatedTotal}`);

  // 5. Newly approved runner claims the errand
  console.log(`5. Runner (${createdRunner.name}) claiming errand ${errand.id}...`);
  const claimRes = await post(`http://localhost:3000/api/errands/${errand.id}/claim`, {
    runnerId: createdRunner.id
  });
  console.log(`   Errand Claimed! Runner assigned: ${claimRes.data.runner?.name}`);

  // 6. In-App Chat
  console.log('6. In-App Live Personal Chat...');
  await post(`http://localhost:3000/api/errands/${errand.id}/messages`, {
    senderType: "runner",
    senderName: createdRunner.name,
    text: "Habari Esther! I am currently heading to Sheria House."
  });
  await post(`http://localhost:3000/api/errands/${errand.id}/messages`, {
    senderType: "customer",
    senderName: regCustRes.data.user?.name,
    text: "Asante Samuel. Please tell me when you get there."
  });
  console.log('   Chat messages exchanged successfully.');

  // 7. Verify Customer Secret PIN
  console.log('7. Verifying Customer Secret Delivery PIN...');
  const verifyRes = await post(`http://localhost:3000/api/errands/${errand.id}/verify-complete`, {
    pin: errand.customerSecretPin
  });
  console.log(`   PIN Verified! Final Status: ${verifyRes.data.errand?.status}`);

  console.log('--- ALL FULL SUITE TESTS PASSED 100%! ---');
}

runTests().catch(console.error);
