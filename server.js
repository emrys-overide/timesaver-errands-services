const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

// Ensure uploads dir exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// --- Database Helper Functions ---
function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const content = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error("Error reading db.json, fallback to defaults", err);
  }
  return { users: [], runners: [], errands: [], stages: [], admins: [] };
}

let db = loadDb();

function saveDb() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error("Error saving db.json", err);
  }
}

// Helper to save base64 image to public/uploads
function saveBase64Image(dataString, prefix = 'upload') {
  if (!dataString || !dataString.startsWith('data:image')) {
    return dataString; // Return as-is if already a URL
  }
  try {
    const matches = dataString.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return dataString;
    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    const filename = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    return `/uploads/${filename}`;
  } catch (e) {
    console.error("Failed to write image file", e);
    return dataString;
  }
}

// Active SSE Connections
let sseClients = [];

function broadcastEvent(eventName, payload) {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.res.write(data);
    } catch (e) {}
  });
}

// Cost Estimator Algorithm
function estimateErrandCost(category, urgency, stageFrom, stageTo, customKm, isPeak) {
  let baseFee = 250;
  if (category === 'queueing') baseFee = 380;
  else if (category === 'shopping') baseFee = 320;
  else if (category === 'pharmacy') baseFee = 220;
  else if (category === 'parcel') baseFee = 200;
  else if (category === 'hardware') baseFee = 350;
  else baseFee = 250;

  if (urgency === 'urgent') baseFee += 100;

  const matchedStage = (db.stages || []).find(s => 
    (s.from.toLowerCase().includes(stageFrom.toLowerCase()) && s.to.toLowerCase().includes(stageTo.toLowerCase())) ||
    (s.to.toLowerCase().includes(stageFrom.toLowerCase()) && s.from.toLowerCase().includes(stageTo.toLowerCase()))
  );

  let fare = 50;
  let km = 5.0;

  if (matchedStage) {
    fare = isPeak ? matchedStage.peakFare : matchedStage.standardFare;
    km = matchedStage.distanceKm;
  } else {
    km = customKm && customKm > 0 ? customKm : 6.0;
    fare = isPeak ? Math.round(km * 12 + 30) : Math.round(km * 9 + 20);
    fare = Math.ceil(fare / 10) * 10;
    if (fare < 40) fare = 40;
    if (fare > 200) fare = 200;
  }

  return {
    baseServiceFee: baseFee,
    transitAllowance: fare,
    matatuFare: fare,
    distanceKm: km,
    estimatedTotal: baseFee + fare
  };
}

// MIME Types
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Main Request Handler
const handleRequest = (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // SSE Stream
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    const clientId = Date.now();
    const newClient = { id: clientId, res };
    sseClients.push(newClient);
    res.write(`event: connected\ndata: ${JSON.stringify({ message: "Time Saver Dispatch Connected" })}\n\n`);
    req.on('close', () => {
      sseClients = sseClients.filter(c => c.id !== clientId);
    });
    return;
  }

  // Helper to parse JSON body (up to 25MB for document photos)
  const parseJsonBody = (callback) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Payload too large" }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        callback(null, parsed);
      } catch (err) {
        callback(err, null);
      }
    });
  };

  // --- Public APIs ---

  // GET /api/stages
  if (pathname === '/api/stages' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.stages || []));
    return;
  }

  // GET /api/runners (Returns approved vetted runners for public selection)
  if (pathname === '/api/runners' && method === 'GET') {
    const approved = (db.runners || []).filter(r => r.verificationStatus === 'approved');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(approved));
    return;
  }

  // POST /api/estimate-cost
  if (pathname === '/api/estimate-cost' && method === 'POST') {
    parseJsonBody((err, payload) => {
      if (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Invalid payload" }));
        return;
      }
      const calculation = estimateErrandCost(
        payload.category || 'general',
        payload.urgency || 'standard',
        payload.stageFrom || 'CBD (Kencom/Railways)',
        payload.stageTo || 'Westlands',
        payload.customKm || 5,
        payload.isPeak === true
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(calculation));
    });
    return;
  }

  // --- Auth APIs ---

  // POST /api/auth/register-customer
  if (pathname === '/api/auth/register-customer' && method === 'POST') {
    parseJsonBody((err, payload) => {
      if (err || !payload.name || !payload.email || !payload.password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Name, email, and password are required." }));
        return;
      }
      const existing = (db.users || []).find(u => u.email.toLowerCase() === payload.email.toLowerCase());
      if (existing) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "An account with this email already exists. Please log in." }));
        return;
      }
      const newUser = {
        id: `USR-${Math.floor(1000 + Math.random() * 9000)}`,
        name: payload.name.trim(),
        email: payload.email.trim().toLowerCase(),
        phone: payload.phone ? payload.phone.trim() : '+254 700 000 000',
        password: payload.password,
        role: 'customer',
        createdAt: new Date().toISOString()
      };
      if (!db.users) db.users = [];
      db.users.push(newUser);
      saveDb();

      // Omit password in response
      const { password, ...safeUser } = newUser;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, user: safeUser }));
    });
    return;
  }

  // POST /api/auth/login-customer
  if (pathname === '/api/auth/login-customer' && method === 'POST') {
    parseJsonBody((err, payload) => {
      if (err || !payload.email || !payload.password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Email and password are required." }));
        return;
      }
      const user = (db.users || []).find(u => 
        u.email.toLowerCase() === payload.email.toLowerCase() && u.password === payload.password
      );
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Invalid email or password." }));
        return;
      }
      const { password, ...safeUser } = user;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, user: safeUser }));
    });
    return;
  }

  // POST /api/auth/register-runner (RUNNER REGISTRATION WITH SELFIE, ID FRONT, ID BACK)
  if (pathname === '/api/auth/register-runner' && method === 'POST') {
    parseJsonBody((err, payload) => {
      if (err || !payload.name || !payload.phone || !payload.email || !payload.password || !payload.idNumber) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Name, phone, email, password, and National ID Number are required." }));
        return;
      }

      const existing = (db.runners || []).find(r => 
        r.email.toLowerCase() === payload.email.toLowerCase() || r.phone === payload.phone
      );
      if (existing) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "A runner account with this email or phone number is already registered." }));
        return;
      }

      // Save uploaded images (Selfie Avatar, ID Front, ID Backward)
      const avatarUrl = saveBase64Image(payload.avatar, 'avatar') || 
        "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80";
      const idFrontUrl = saveBase64Image(payload.idCardFront, 'id-front') || 
        "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=600&q=80";
      const idBackUrl = saveBase64Image(payload.idCardBack, 'id-back') || 
        "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80";

      const idMasked = payload.idNumber.length > 4 
        ? `ID: ${payload.idNumber.substring(0, 2)}***${payload.idNumber.substring(payload.idNumber.length - 3)}`
        : `ID: ${payload.idNumber}`;

      const newRunner = {
        id: `RUN-${Math.floor(100 + Math.random() * 900)}`,
        name: payload.name.trim(),
        email: payload.email.trim().toLowerCase(),
        phone: payload.phone.trim(),
        password: payload.password,
        idNumber: payload.idNumber.trim(),
        idNumberVerified: `${idMasked} (Verification Pending)`,
        avatar: avatarUrl,
        idCardFront: idFrontUrl,
        idCardBack: idBackUrl,
        verificationStatus: 'pending', // Starts as pending until Admin approves
        rating: 5.0,
        completedErrands: 0,
        activeLocation: payload.activeLocation || 'CBD / Kencom Stage',
        bio: payload.bio || 'Ready to save your time and run errands efficiently across Nairobi.',
        vehicleType: payload.vehicleType || 'Foot & Matatu Transit',
        badge: 'Pending Verification',
        createdAt: new Date().toISOString()
      };

      if (!db.runners) db.runners = [];
      db.runners.unshift(newRunner);
      saveDb();

      broadcastEvent('runner_registered', {
        id: newRunner.id,
        name: newRunner.name,
        activeLocation: newRunner.activeLocation
      });

      const { password, ...safeRunner } = newRunner;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: "Registration successful! Your profile and ID documents are submitted for Time Saver Admin verification.",
        runner: safeRunner
      }));
    });
    return;
  }

  // POST /api/auth/login-runner
  if (pathname === '/api/auth/login-runner' && method === 'POST') {
    parseJsonBody((err, payload) => {
      if (err || !payload.login || !payload.password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Email or phone and password are required." }));
        return;
      }
      const loginTerm = payload.login.trim().toLowerCase();
      const runner = (db.runners || []).find(r => 
        (r.email.toLowerCase() === loginTerm || r.phone === payload.login.trim()) && r.password === payload.password
      );
      if (!runner) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Invalid runner credentials." }));
        return;
      }
      const { password, ...safeRunner } = runner;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, runner: safeRunner }));
    });
    return;
  }

  // POST /api/auth/login-admin
  if (pathname === '/api/auth/login-admin' && method === 'POST') {
    parseJsonBody((err, payload) => {
      if (err || !payload.email || !payload.password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Admin email and password required." }));
        return;
      }
      const admin = (db.admins || []).find(a => 
        a.email.toLowerCase() === payload.email.trim().toLowerCase() && a.password === payload.password
      );
      if (!admin) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Invalid admin credentials." }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, admin: { id: admin.id, name: admin.name, email: admin.email, role: 'admin' } }));
    });
    return;
  }

  // --- Admin Portal APIs ---

  // GET /api/admin/overview
  if (pathname === '/api/admin/overview' && method === 'GET') {
    const totalErrands = (db.errands || []).length;
    const completedErrands = (db.errands || []).filter(e => e.status === 'completed').length;
    const totalRevenue = (db.errands || []).reduce((sum, e) => sum + (e.estimatedTotal || 0), 0);
    const totalMatatuPaid = (db.errands || []).reduce((sum, e) => sum + (e.matatuFare || 0), 0);
    const totalRunners = (db.runners || []).length;
    const pendingRunners = (db.runners || []).filter(r => r.verificationStatus === 'pending').length;
    const totalCustomers = (db.users || []).length;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      totalErrands,
      completedErrands,
      totalRevenue,
      totalMatatuPaid,
      totalRunners,
      pendingRunners,
      totalCustomers
    }));
    return;
  }

  // GET /api/admin/runners (Returns all runners with their ID photos and statuses)
  if (pathname === '/api/admin/runners' && method === 'GET') {
    const safeRunners = (db.runners || []).map(r => {
      const { password, ...rest } = r;
      return rest;
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(safeRunners));
    return;
  }

  // POST /api/admin/runners/:id/verify (Admin approves or rejects runner)
  if (pathname.match(/^\/api\/admin\/runners\/[^/]+\/verify$/) && method === 'POST') {
    const runnerId = pathname.split('/')[4];
    parseJsonBody((err, payload) => {
      const runner = (db.runners || []).find(r => r.id === runnerId);
      if (!runner) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Runner not found" }));
        return;
      }
      const action = payload.action; // 'approve' or 'reject'
      if (action === 'approve') {
        runner.verificationStatus = 'approved';
        runner.badge = 'Verified Pro';
        const idMasked = runner.idNumber ? `ID: ${runner.idNumber.substring(0, 2)}***${runner.idNumber.substring(runner.idNumber.length - 3)}` : 'ID: Verified';
        runner.idNumberVerified = `${idMasked} (Police Clearance & ID Verified)`;
      } else {
        runner.verificationStatus = 'rejected';
        runner.badge = 'Rejected';
      }
      saveDb();
      broadcastEvent('runner_verified', { runnerId: runner.id, status: runner.verificationStatus });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, runner }));
    });
    return;
  }

  // POST /api/admin/errands/:id/verify-payment (Admin marks M-Pesa received)
  if (pathname.match(/^\/api\/admin\/errands\/[^/]+\/verify-payment$/) && method === 'POST') {
    const errandId = pathname.split('/')[4];
    const errand = (db.errands || []).find(e => e.id === errandId);
    if (!errand) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "Errand not found" }));
      return;
    }
    errand.paymentStatus = errand.paymentStatus === 'Verified' ? 'Pending Manual M-Pesa' : 'Verified';
    saveDb();
    broadcastEvent('payment_updated', errand);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, errand }));
    return;
  }

  // --- Errand Flow APIs ---

  // GET /api/errands
  if (pathname === '/api/errands' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.errands || []));
    return;
  }

  // POST /api/errands (Customer places order)
  if (pathname === '/api/errands' && method === 'POST') {
    parseJsonBody((err, data) => {
      if (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      const orderNum = Math.floor(1000 + Math.random() * 9000);
      const secretPin = Math.floor(1000 + Math.random() * 9000).toString();

      const calculation = estimateErrandCost(
        data.category || 'general',
        data.urgency || 'standard',
        data.matatuStageFrom || 'CBD (Kencom/Railways)',
        data.matatuStageTo || 'Westlands',
        data.distanceKm || 5,
        data.isPeak === true
      );

      const newErrand = {
        id: `ERR-${orderNum}`,
        customerId: data.customerId || null,
        title: data.title || "Custom Errand Task",
        category: data.category || "general",
        description: data.description || "",
        pickupLocation: data.pickupLocation || "Specified Store / Pickup Point",
        dropoffLocation: data.dropoffLocation || "Specified Dropoff Address",
        customerLocation: data.customerLocation || data.dropoffLocation,
        customerName: data.customerName || "Customer",
        customerPhone: data.customerPhone || "+254 700 000 000",
        customerSecretPin: secretPin, // Only revealed to the user!
        urgency: data.urgency || "standard",
        matatuStageFrom: data.matatuStageFrom || "CBD (Kencom/Railways)",
        matatuStageTo: data.matatuStageTo || "Westlands",
        matatuFare: calculation.matatuFare,
        baseServiceFee: calculation.baseServiceFee,
        transitAllowance: calculation.transitAllowance,
        distanceKm: calculation.distanceKm,
        estimatedTotal: calculation.estimatedTotal,
        status: "available",
        runnerId: null,
        runner: null,
        createdAt: new Date().toISOString(),
        demoPaymentAccount: "Till: 542890 (Time Saver Errands Services)",
        demoPaymentPhone: "+254 798 000 123",
        paymentStatus: "Pending Manual M-Pesa",
        messages: []
      };

      if (!db.errands) db.errands = [];
      db.errands.unshift(newErrand);
      saveDb();
      broadcastEvent('errand_created', newErrand);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newErrand));
    });
    return;
  }

  // POST /api/errands/:id/claim (Runner claims errand)
  if (pathname.match(/^\/api\/errands\/[^/]+\/claim$/) && method === 'POST') {
    const errandId = pathname.split('/')[3];
    parseJsonBody((err, payload) => {
      const errand = (db.errands || []).find(e => e.id === errandId);
      if (!errand) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Errand not found" }));
        return;
      }
      if (errand.status !== 'available') {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "This errand has already been claimed by another runner." }));
        return;
      }

      const runner = (db.runners || []).find(r => r.id === (payload.runnerId || 'RUN-101')) || db.runners[0];
      const { password, idCardFront, idCardBack, ...safeRunner } = runner;

      errand.status = 'claimed';
      errand.runnerId = runner.id;
      errand.runner = safeRunner;
      errand.claimedAt = new Date().toISOString();

      if (!errand.messages) errand.messages = [];
      errand.messages.push({
        id: `msg-${Date.now()}`,
        senderType: "system",
        senderName: "System",
        text: `🎉 Errand picked up by ${runner.name} (${runner.badge}). You can now chat or call directly!`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });

      saveDb();
      broadcastEvent('errand_claimed', errand);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(errand));
    });
    return;
  }

  // POST /api/errands/:id/status (Runner updates progress)
  if (pathname.match(/^\/api\/errands\/[^/]+\/status$/) && method === 'POST') {
    const errandId = pathname.split('/')[3];
    parseJsonBody((err, payload) => {
      const errand = (db.errands || []).find(e => e.id === errandId);
      if (!errand) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Errand not found" }));
        return;
      }

      const newStatus = payload.status;
      errand.status = newStatus;
      errand.updatedAt = new Date().toISOString();

      let statusText = "Errand status updated";
      if (newStatus === 'in_progress') statusText = "Runner has arrived at the pickup/store location and is executing the task.";
      if (newStatus === 'delivering') statusText = "Task completed at location! Runner is taking transit/matatu to drop-off point.";
      if (newStatus === 'completed') statusText = "Errand successfully verified & delivered!";

      if (!errand.messages) errand.messages = [];
      errand.messages.push({
        id: `msg-${Date.now()}`,
        senderType: "system",
        senderName: "Status Alert",
        text: `📍 ${statusText}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });

      saveDb();
      broadcastEvent('errand_status_updated', errand);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(errand));
    });
    return;
  }

  // POST /api/errands/:id/verify-complete (Runner enters customer's secret PIN)
  if (pathname.match(/^\/api\/errands\/[^/]+\/verify-complete$/) && method === 'POST') {
    const errandId = pathname.split('/')[3];
    parseJsonBody((err, payload) => {
      const errand = (db.errands || []).find(e => e.id === errandId);
      if (!errand) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Errand not found" }));
        return;
      }

      const enteredPin = (payload.pin || '').trim();
      if (enteredPin !== errand.customerSecretPin) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Incorrect Secret Customer Release PIN. Please ask the customer for the 4-digit code on their screen." }));
        return;
      }

      errand.status = 'completed';
      errand.completedAt = new Date().toISOString();
      errand.verifiedReleasePin = enteredPin;

      // Increment runner's completed errands count
      if (errand.runnerId) {
        const assignedRunner = (db.runners || []).find(r => r.id === errand.runnerId);
        if (assignedRunner) {
          assignedRunner.completedErrands = (assignedRunner.completedErrands || 0) + 1;
        }
      }

      if (!errand.messages) errand.messages = [];
      errand.messages.push({
        id: `msg-${Date.now()}`,
        senderType: "system",
        senderName: "Security Verification",
        text: `✅ Verified with Customer Secret Release PIN (${enteredPin}). Errand marked complete!`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });

      saveDb();
      broadcastEvent('errand_completed', errand);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, errand }));
    });
    return;
  }

  // POST /api/errands/:id/messages (Chat)
  if (pathname.match(/^\/api\/errands\/[^/]+\/messages$/) && method === 'POST') {
    const errandId = pathname.split('/')[3];
    parseJsonBody((err, payload) => {
      const errand = (db.errands || []).find(e => e.id === errandId);
      if (!errand) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Errand not found" }));
        return;
      }

      const messageObj = {
        id: `msg-${Date.now()}`,
        senderType: payload.senderType || 'customer',
        senderName: payload.senderName || (payload.senderType === 'runner' ? (errand.runner?.name || 'Runner') : errand.customerName),
        text: payload.text || '',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      if (!errand.messages) errand.messages = [];
      errand.messages.push(messageObj);
      saveDb();

      broadcastEvent('chat_message', { errandId, message: messageObj });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(messageObj));
    });
    return;
  }

  // POST /api/reset (Reset state to db default)
  if (pathname === '/api/reset' && method === 'POST') {
    db = loadDb();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // --- Static File Server ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, content2) => {
          if (err2) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content2);
          }
        });
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
};

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🚀 Time Saver Errands Services running on port ${PORT}`);
  });
}

module.exports = handleRequest;
