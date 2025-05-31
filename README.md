# SentinelPay Banking API System

SentinelPay is a secure and scalable banking API system with advanced fraud detection capabilities. It provides a complete backend solution for financial transactions, user management, and fraud prevention.

## Features

### Transaction Processing
- ACID-compliant transaction handling
- Multiple transaction types (deposits, withdrawals, transfers, payments)
- Transaction validation and rollback mechanisms
- Real-time balance updates
- Transaction receipts with digital signatures

### Security
- JWT-based authentication with refresh tokens
- Role-based access control (RBAC)
- Two-factor authentication (2FA)
- Rate limiting and IP-based security
- Request signing for transaction integrity
- Data encryption for sensitive information
- Comprehensive input validation and sanitization

### Fraud Detection
- Real-time transaction monitoring
- ML-based fraud detection using TensorFlow.js
- Daily scheduled fraud detection scans
- Multiple detection methods:
  - Unusual transaction amounts
  - Unusual locations/IP addresses
  - Suspicious transaction patterns
  - User behavior analysis
- Automated alerting system
- Fraud case management for investigation

### API Design
- RESTful endpoints with comprehensive documentation
- OpenAPI/Swagger specification
- Proper error handling and status codes
- Request/response validation
- API versioning
- Pagination for large data sets
- Caching strategies

### Architecture
- Modular code structure
- Clean separation of concerns (MVC pattern)
- Middleware-based request processing
- Service-based business logic
- Comprehensive logging system
- Redis caching for performance
- MongoDB database integration

## Getting Started

### Prerequisites
- Node.js (v14+)
- MongoDB
- Redis (optional, for enhanced caching)

### Installation

1. Clone the repository
```bash
git clone https://github.com/your-username/sentinelpay.git
cd sentinelpay
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start the server
```bash
npm start
```

For development:
```bash
npm run dev
```

### API Documentation

API documentation is available at `/api/docs` when the server is running. This provides a Swagger UI interface to explore and test all endpoints.

## Security Features

SentinelPay implements multiple layers of security:

1. **Authentication**
   - JWT tokens with short expiration
   - Refresh token rotation
   - API key authentication for services
   - Two-factor authentication

2. **Authorization**
   - Role-based access control
   - Resource-based permissions
   - Transaction validation

3. **Data Protection**
   - Encryption for sensitive data
   - Password hashing with bcrypt
   - Masking of account numbers in responses

4. **Fraud Prevention**
   - Real-time transaction monitoring
   - ML-based anomaly detection
   - IP-based risk assessment
   - Velocity checks and pattern recognition

5. **Infrastructure Security**
   - Rate limiting
   - Request validation
   - Error handling without leaking details
   - Comprehensive logging and monitoring

## ML-Based Fraud Detection

SentinelPay uses TensorFlow.js to provide machine learning-based fraud detection:

1. **Model Training**
   - Scheduled weekly model training using historical transaction data
   - Features extracted from transaction patterns, user behavior, and account history
   - Binary classification model (fraud/legitimate)

2. **Real-Time Prediction**
   - Each transaction is scored in real-time
   - Transactions with high fraud scores are held for review
   - Combination of rule-based checks and ML predictions

3. **Continuous Improvement**
   - Feedback loop from resolved fraud cases
   - Model accuracy tracking
   - Feature engineering refinement

## Architecture

SentinelPay follows a modular architecture:

```
src/
├── controllers/     # Request handlers
├── middlewares/     # Express middlewares
├── models/          # Mongoose models
├── routes/          # API routes
├── services/        # Business logic
├── ml/              # Machine learning models
├── utils/           # Utility functions
└── server.js        # Application entry point
```

