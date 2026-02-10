# FlyZed – Sky Crash Game 🛩️

A provably-fair crash game platform built with **Node.js**, **Express**, **PostgreSQL**, and **Socket.IO**. Fully integrated with **MTN Mobile Money** for real-money transactions in Zambia.

**Live Platform**: [FlyZed.onrender.com](https://flyzed.onrender.com)

---

## 📋 Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running Locally](#running-locally)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Deployment](#deployment)
- [Responsible Gaming](#responsible-gaming)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

---

## ✨ Features

### Game Features
- **Provably-Fair Crashes**: HMAC-SHA256 deterministic crash calculation
- **Real-Time Multipliers**: Socket.IO broadcast for instant updates
- **Crash Distribution Analysis**: Admin dashboard with anomaly detection
- **RTP Monitoring**: Return to Player tracking (target: 90-97%)
- **Demo Mode**: Test gameplay with virtual balance

### Payment Integration
- **MTN Mobile Money**: Deposits & withdrawals via MTN Zambia
- **Webhook Callbacks**: Automatic transaction status updates
- **Sandbox Support**: Easy sandbox-to-production switch
- **Payment Tracking**: Full audit log of all transactions

### Security & Compliance
- **JWT Authentication**: Secure token-based auth
- **Rate Limiting**: Prevent brute force attacks
- **Input Validation**: Sanitize all user inputs
- **Daily Loss Limits**: Protect players from excessive losses
- **Self-Exclusion**: Users can voluntarily disable accounts
- **Age Verification**: 18+ requirement with database tracking
- **Terms & Conditions**: Legal acceptance tracking

### Admin Features
- **Admin Dashboard**: Real-time metrics and monitoring
- **Kill Switch**: Emergency pause/resume for games and payments
- **User Management**: View, manage, and refund users
- **Payment Administration**: Manage payment transactions
- **Monitoring Snapshots**: Historical data for analysis
- **Alert System**: Critical event notifications

### Development Features
- **Structured Logging**: JSON-formatted logs with levels
- **Comprehensive Error Handling**: Graceful error responses
- **Database Transactions**: ACID-compliant operations
- **Health Checks**: Built-in health endpoints
- **Migration System**: Version control for database schema

---

## 🛠 Tech Stack

### Backend
- **Node.js** (v16+)
- **Express.js** – REST API framework
- **PostgreSQL** – Primary database
- **Socket.IO** – Real-time WebSocket communication
- **JWT** – Token-based authentication
- **Bcrypt** – Password hashing

### Frontend
- **HTML5 / CSS3 / Vanilla JavaScript**
- **Socket.IO Client** – Real-time updates
- **Web Crypto API** – Client-side cryptography
- **Responsive Design** – Mobile-friendly UI

### DevOps
- **Render** – Hosting and deployment
- **PostgreSQL** – Managed database (Render PostgreSQL)
- **Environment Variables** – Configuration management

### Security
- **HTTPS/SSL** – Encrypted transport
- **CORS** – Cross-origin protection
- **Rate Limiting** – Brute force protection
- **Input Sanitization** – XSS prevention

---

## 📦 Installation

### Prerequisites
- **Node.js** v16 or higher
- **PostgreSQL** 12 or higher
- **npm** package manager

### Clone Repository
```bash
git clone https://github.com/cosmaskafulajr-crypto/flyzed.git
cd flyzed
