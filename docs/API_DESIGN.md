# SentinelPay API Design Document

This document outlines the API design principles and specifications for the SentinelPay banking system.

## API Standards

### URL Structure
- Base path: `/api`
- Version prefix: Not in URL path, managed through content negotiation
- Resource naming: Plural nouns for collections (e.g., `/users`, `/transactions`)
- Resource identifiers: MongoDB ObjectIds in URL paths (e.g., `/users/{id}`)
- Nested resources: Used for clear ownership (e.g., `/accounts/{id}/transactions`)

### HTTP Methods
- `GET`: Retrieve resources
- `POST`: Create resources
- `PUT`: Replace resources
- `PATCH`: Partially update resources
- `DELETE`: Remove resources (or soft-delete by updating status)

### Response Formats
All API responses follow a consistent structure:

**Success Response:**
```json
{
  "status": "success",
  "data": {
    "key": "value"
  }
}
```

**Error Response:**
```json
{
  "status": "error",
  "message": "Error description",
  "code": "ERROR_CODE"
}
```

### Status Codes
- `200`: OK (successful GET, PUT, PATCH)
- `201`: Created (successful POST)
- `204`: No Content (successful DELETE)
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (authentication required)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found (resource doesn't exist)
- `422`: Unprocessable Entity (semantic errors)
- `429`: Too Many Requests (rate limiting)
- `500`: Internal Server Error (server issues)

### Pagination
Collection endpoints support pagination:

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 10, max: 100)

**Response:**
```json
{
  "status": "success",
  "results": 10,
  "totalPages": 5,
  "currentPage": 1,
  "data": {
    "items": [...]
  }
}
```

### Filtering and Sorting
Collection endpoints support filtering and sorting:

**Filtering:**
- Simple filters: `?status=active&type=checking`
- Date range: `?startDate=2023-01-01&endDate=2023-01-31`
- Value range: `?minAmount=100&maxAmount=1000`

**Sorting:**
- Sort field: `?sort=createdAt`
- Sort direction: `?order=desc`

### Authentication
- Bearer token authentication: `Authorization: Bearer {token}`
- API key for service-to-service: `X-API-Key: {key}`
- Two-factor authentication for sensitive operations

### Rate Limiting
- Default: 100 requests per 15-minute window per IP
- Authentication endpoints: 10 requests per 15-minute window per IP
- Response headers include rate limit information

## API Resource Groups

### Authentication
- `POST /auth/signup`: Register new user
- `POST /auth/login`: User login
- `POST /auth/logout`: User logout
- `POST /auth/refresh-token`: Refresh access token
- `POST /auth/forgot-password`: Request password reset
- `PATCH /auth/reset-password/{token}`: Reset password
- `POST /auth/setup-2fa`: Set up two-factor authentication
- `POST /auth/verify-2fa`: Verify 2FA token
- `POST /auth/enable-2fa`: Enable 2FA
- `POST /auth/disable-2fa`: Disable 2FA
- `PATCH /auth/update-password`: Change password

### Users
- `GET /users/me`: Get current user
- `PATCH /users/me`: Update current user
- `GET /users/{id}`: Get user by ID (admin)
- `PATCH /users/{id}`: Update user (admin)
- `DELETE /users/{id}`: Delete user (admin)
- `GET /users`: List users (admin)

### Accounts
- `POST /accounts`: Create new account
- `GET /accounts`: List user's accounts
- `GET /accounts/{id}`: Get account details
- `PATCH /accounts/{id}`: Update account
- `DELETE /accounts/{id}`: Close account
- `GET /accounts/{id}/transactions`: Get account transactions
- `GET /accounts/{id}/balance-history`: Get balance history

### Transactions
- `POST /transactions`: Create transaction
- `GET /transactions`: List user's transactions
- `GET /transactions/{id}`: Get transaction details
- `GET /transactions/{id}/receipt`: Get transaction receipt
- `POST /transactions/{id}/reverse`: Reverse transaction
- `POST /transactions/analyze`: Analyze transaction for fraud

### Fraud Management
- `GET /fraud/cases`: List fraud cases (admin)
- `GET /fraud/cases/{id}`: Get fraud case details (admin)
- `PATCH /fraud/cases/{id}`: Update fraud case (admin)
- `POST /fraud/cases/{id}/action`: Add action to fraud case (admin)
- `POST /fraud/user-report`: Report fraudulent transaction
- `GET /fraud/summary`: Get fraud statistics (admin)

### Admin Operations
- `GET /admin/stats`: Get system statistics
- `GET /admin/logs`: Get system logs
- `POST /admin/backup`: Trigger system backup
- `POST /admin/restore`: Restore from backup

## Webhooks

SentinelPay supports webhooks for event notifications:

- `transaction.created`
- `transaction.completed`
- `transaction.failed`
- `transaction.reversed`
- `fraud.detected`
- `account.created`
- `account.updated`
- `account.frozen`
- `account.closed`

Webhook subscriptions are managed through the admin interface.

## API Versioning

Versioning is managed through content negotiation using the `Accept` header:

```
Accept: application/json; version=1.0
```

## Security Considerations

1. **Authentication:**
   - Tokens are short-lived (1 hour default)
   - Refresh tokens can be revoked at any time
   - Failed login attempts are rate-limited
   - 2FA required for sensitive operations

2. **Authorization:**
   - Granular permissions system
   - Resources are scoped to the authenticated user
   - Admin operations require special roles

3. **Data Protection:**
   - PII is encrypted at rest
   - Sensitive fields are filtered from responses
   - Masking of account details in receipts and notifications

4. **Request Validation:**
   - All inputs are validated and sanitized
   - Strict schema validation for all requests
   - Protection against injection attacks

5. **Infrastructure Security:**
   - Rate limiting to prevent brute-force attacks
   - CORS configuration to limit origins
   - Security headers (Helmet middleware)
   - No sensitive data in error responses