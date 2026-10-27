# ChapChap Errands ⚡

> **On-Demand Minimalist Errand Service Platform** featuring Runner Registration with National ID Front & Back verification, Customer Authentication, Operations Admin Portal, Matatu Fare Quantification, Live Runner Matching, In-App Chat, and Customer Release PIN Security.

---

## 🌟 Key Features

### 1. 🚴 Errand Runner Self-Registration & ID Document Vetting
- **Self-Service Registration**:
  - Full Name, Phone (M-Pesa registered), Email, Password, National ID Number.
  - Active base stage/area (e.g. Kencom/CBD, Westlands, Kilimani, Upperhill, Roysambu, etc.).
  - Transit method (Foot & Matatu Transit, Boda, Bicycle).
  - Short Bio and errand specialties.
- **Biometric & Identity Document Uploads**:
  - **Selfie / Clear Photo of Themselves** (Avatar)
  - **National ID Card - FRONT Photo**
  - **National ID Card - BACKWARD (BACK) Photo**
- **Pending Review Workflow**:
  - Registered runners enter a "Pending Review" state until verified by the Operations Admin.

### 2. 🔐 User (Customer) Account Creation & Authentication
- Full sign up and login with email & password.
- Logged-in customers have their contact details automatically pre-filled when placing errand orders.
- Unified modal with seamless tab switching between Customer Login, Customer Sign Up, Runner Login, and Admin Login.

### 3. 🛡️ Operations Admin Portal (`/api/admin`)
- **Credentials**: `admin@chapchap.co.ke` / `admin123`
- **Executive Metrics Dashboard**:
  - Total Errands, Completed Errands, Gross Volume (KES).
  - Total Matatu Transit Allowance distributed.
  - Pending Runner Applications count.
- **National ID Document Inspector**:
  - Inspect the runner's Selfie, Front ID, and Backward ID side-by-side.
  - Actions: **"Approve & Issue Vetted Badge"** or **"Reject"**.
- **Platform Errands & Payment Verifier**:
  - View all errands, customer & runner details, and Customer Secret Release PINs.
  - One-click toggle to mark manual M-Pesa payments (Till 542890) as **Verified**.

### 4. 🛒 Errand Placement & Matatu Fare Quantification
- Calculates fair base labor fee based on errand category (Shopping, Office/Queueing, Parcel, Pharmacy, Hardware, Custom).
- **Integrated Matatu Fare Engine**:
  - Dynamic route stages across Nairobi (CBD, Westlands, Kilimani, Upperhill, Roysambu, Karen, South B, Eastleigh).
  - Peak hours rush surge toggle.
  - Transparent itemized invoice: Runner Labor Fee + Matatu Commute Allowance = Total Payable.

### 5. 📱 Demo Manual Payment Box (No In-App Gateway)
- Frictionless payment instructions:
  - **Demo M-Pesa Buy Goods Till**: `542890` *(ChapChap Errands Hub)*
  - **Or Demo Phone**: `0798 000 123`
  - **Reference**: Order ID (e.g., `ERR-7102`)

### 6. 🔒 Secret Customer Release PIN (Only Exposed to User)
- Every placed errand generates a unique 4-digit code (e.g. `8492`) visible **only on the customer's screen**.
- When the runner arrives at delivery, the runner must request this PIN from the customer and input it in their app to unlock completion and verify payout release.

### 7. 💬 In-App Live Personal Chat
- Real-time instant messaging drawer between customer and assigned runner.
- Includes quick-canned status replies on mobile (*"Arrived at location"*, *"In queue"*, *"Boarding matatu now"*, *"Outside gate"*).
- Synchronized live through Server-Sent Events (SSE).

---

## 🚀 Running Locally

```bash
# 1. Install dependencies (Node.js standard built-ins used)
npm install

# 2. Start the server
npm start
```
Open **http://localhost:3000** in your browser.

---

## ☁️ Deployment

### Deploy to Render
This repository includes [`render.yaml`](render.yaml) for 1-click deployment on Render:
1. Push this repository to GitHub.
2. In Render, select **New Web Service** and link your GitHub repository.
3. Render automatically detects `npm start` and provisions the service.

### Deploy to Vercel
This repository includes [`vercel.json`](vercel.json) and [`api/index.js`](api/index.js) for Vercel Serverless deployment:
1. Import the repository into your Vercel Dashboard.
2. Click **Deploy**. Vercel will route all requests through `api/index.js`.
