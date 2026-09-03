# Behavioral diff — externalize JWT secret breaks GET /api/user/whoami

**Behavioral change detected.** `whoami_admin` returns **200 → 403**.

## Before

```mermaid
sequenceDiagram
    autonumber
    participant Client as Client
    participant App as App
    participant JWTAuthenticationFilter as JWTAuthenticationFilter
    participant JWTUtilities as JWTUtilities
    participant UserEndpoint as UserEndpoint
    participant UserDao as UserDao
    participant Database as Database
    Client->>App: GET /api/user/whoami
    App->>JWTAuthenticationFilter: handle
    JWTAuthenticationFilter->>JWTUtilities: verifyAndGetSubject
    App->>UserEndpoint: handle
    UserEndpoint->>UserDao: findRolesByUserName
    UserDao->>Database: SELECT person
    App-->>Client: 200 ✅
```

## After

```mermaid
sequenceDiagram
    autonumber
    participant Client as Client
    participant App as App
    participant JWTAuthenticationFilter as JWTAuthenticationFilter
    participant JWTUtilities as JWTUtilities
    Client->>App: GET /api/user/whoami
    rect rgb(255, 224, 224)
    App-xJWTAuthenticationFilter: handle
    Note over JWTAuthenticationFilter: 💥 throws HaltException
    Note over JWTAuthenticationFilter: ✗ 403 — path stops here
    end
    JWTAuthenticationFilter-xJWTUtilities: verifyAndGetSubject
    Note over JWTUtilities: 💥 throws SignatureVerificationException
    App-->>Client: 403 ⛔
```

## What changed

- **Response 200 → 403** on `GET /api/user/whoami`.
- **Exception introduced:** `handle` now throws `HaltException`.
- **Exception introduced:** `verifyAndGetSubject` now throws `SignatureVerificationException`.
- **Step no longer runs:** `App → UserEndpoint: handle` is gone (code below it is never reached).
- **Step no longer runs:** `UserEndpoint → UserDao: findRolesByUserName` is gone (code below it is never reached).
- **Step no longer runs:** `UserDao → Database: SELECT person` is gone (code below it is never reached).
