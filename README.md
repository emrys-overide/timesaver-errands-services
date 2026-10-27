# Time Saver Errands Services ⏱️

> **Save Your Time, We Run the Town.**  
> *Nairobi's On-Demand Errand & Delivery Service with Integrated Matatu Transit Fare Quantification, Runner ID Document Verification, In-App Chat, and Customer Release PIN Security.*

---

## 🎯 Official Brand & Slogan

- **Brand Name**: **Time Saver Errands Services**
- **Primary Slogan**: *"Save Your Time, We Run the Town."*
- **Alternative Tagline**: *"Skip the Lines, Skip the Traffic — Your Errands Handled Swiftly."*

---

## 🌟 Key Platform Features

### 1. 🚴 Errand Runner Registration with Biometrics & ID Verification
- Self-registration for errand runners across Nairobi stages.
- **Biometric & Identity Document Uploads**:
  - **Selfie / Clear Photo of Themselves** (Avatar)
  - **National ID Card - FRONT Photo**
  - **National ID Card - BACKWARD (BACK) Photo**
- Applications enter a **"Pending Review"** state until verified by an Admin.

### 2. 🔐 Customer Account Creation & Sign In
- Full customer authentication with Name, Phone, Email, and Password.
- Automatic contact pre-fill when placing errand orders.
- Unified switcher between Customer, Runner, and Admin logins.

### 3. 🛡️ Operations Admin Portal (`/api/admin`)
- **Credentials**: `admin@timesaver.co.ke` / `admin123`
- **Metrics Dashboard**: Total Errands, Completed Errands, Gross Volume (KES), Matatu Transit Allowances distributed, and Pending Runner Applications count.
- **National ID Document Inspector**: Inspect the runner's selfie, **National ID Front**, and **National ID Backward** side-by-side full size.
- **Actions**: Approve (issues verified badge and unlocks runner dispatch) or Reject application.
- **Payment Verifier**: Toggle manual demo M-Pesa payments (Till `542890`) between *Pending* and *Verified*.

### 4. 🛒 Errand Placement & Matatu Fare Quantification
- Calculates fair base labor fee based on errand category (Shopping, Office/Queueing, Parcel, Pharmacy, Hardware, Custom).
- **Integrated Matatu Fare Engine**:
  - Dynamic route stages across Nairobi (CBD, Westlands, Kilimani, Upperhill, Roysambu, Karen, South B, Eastleigh).
  - Peak hours rush surge toggle.
  - Transparent itemized invoice: Runner Labor Fee + Matatu Commute Allowance = Total Payable.

### 5. 📱 Demo Manual Payment Box (No In-App Gateway)
- Frictionless payment instructions:
  - **Demo M-Pesa Buy Goods Till**: `542890` *(Time Saver Errands Services)*
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
