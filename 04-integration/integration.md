# 4. Integración con servicio externo de inventario

## 1. Alcance y contratos

La API ofrece tres operaciones independientes:

1. Alta de usuario y registro en el servicio externo.
2. Consulta del estado de un producto.
3. Carga de un producto en el servicio externo.

Como la consigna no especifica métodos HTTP, estructuras de los mensajes ni autenticación, se proponen los siguientes contratos. El mecanismo de autenticación debería confirmarse con el proveedor.


| Operación | API local | Servicio externo | Resultado local |
| --- | --- | --- | --- |
| Alta de usuario | `POST /users` | `POST /connect/upload` | `201` si ambas altas son exitosas |
| Consultar producto | `GET /products/{code}` | `GET /getProduct?code={code}` | `200`, `404`, `409` según el resultado |
| Cargar producto | `POST /products` | `POST /upload/product` | `201` si el proveedor responde `200` |

El servicio externo se considera la fuente de verdad del inventario. La base local conserva los usuarios y el estado de las operaciones de integración

## 2. Traducción de respuestas

| Respuesta externa | Significado | Respuesta local propuesta |
| --- | --- | --- |
| Producto disponible | Consulta exitosa | `200` OK |
| PD-001 | El producto no existe | `404` Not Found |
| PD-002 | El producto está reservado | `409` Conflict |
| PD-003 | El producto está agotado | `409` Conflict |
| 200 en la carga | Producto cargado | `201` Created |
| 401 en la carga | Credencial externa inválida o vencida | `502` Bad Gateway |
| 403 en la carga | La integración no tiene permisos | `502` Bad Gateway |
| Error 5xx del proveedor | Falla del proveedor | `502` Bad Gateway |
| Timeout | No se pudo confirmar el resultado | `504` Gateway Timeout |


Los errores 401 y 403 del proveedor no se devuelven directamente al cliente porque corresponden a la autenticación entre nuestra API y el proveedor, no necesariamente a la autenticación del usuario.

## 3. DSS de la integración

El DSS se divide en tres escenarios porque cada operación puede ejecutarse de manera independiente.

### 1. Alta de usuario

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant A as API
    participant DB as Base local
    participant P as Servicio externo

    C->>A: POST /users
    A->>A: Validar datos y autorización

    alt Datos inválidos
        A-->>C: 400 Bad Request
    else Datos válidos
        A->>DB: Consultar usuario por email/externalId
        DB-->>A: Resultado de la búsqueda
        
        alt Usuario existente
            A-->>C: 409 Conflict
        else Usuario nuevo 
            A->>DB: Crear usuario con estado PENDING
            DB-->>A: Usuario registrado
            A->>P: POST /connect/upload

            alt Respuesta exitosa
                P-->>A: 2xx + identificador externo
                A->>DB: Actualizar estado a SYNCHRONIZED
                DB-->>A: Actualización confirmada
                A-->>C: 201 Created + usuario
            else Error 4xx del proveedor
                P-->>A: 4xx + detalle
                A->>DB: Actualizar estado a FAILED
                A-->>C: 502 Bad Gateway
            else Error 5xx del proveedor
                P-->>A: 5xx
                A->>DB: Mantener estado PENDING
                A-->>C: 502 Bad Gateway
            else Timeout
                P--xA: Sin respuesta
                A->>DB: Mantener estado PENDING
                A-->>C: 504 Gateway Timeout
            end
        end
    end
```

El estado PENDING se mantiene cuando el resultado es incierto. Un timeout no garantiza que el proveedor no haya procesado el alta, por lo que la operación debe reconciliarse antes de volver a enviarla.

### 2. Consulta de producto

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant A as API
    participant P as Servicio externo

    C->>A: GET /products/{code}
    A->>A: Validar código y autorización 

    alt Código inválido
        A-->>C: 400 Bad Request
    else Código válido
        A->>P: GET /getProduct?code={code}

        alt Producto disponible
            P-->>A: Datos del producto
            A-->>C: 200 OK + producto
        else PD-001
            P-->>A: Producto inexistente
            A-->>C: 404 + code PD-001
        else PD-002
            P-->>A: Producto reservado
            A-->>C: 409 + code PD-002
        else PD-003
            P-->>A: Producto agotado
            A-->>C: 409 + code PD-003
        else Error 5xx del proveedor
            P-->>A: 5xx
            A-->>C: 502 Bad Gateway
        else Timeout
            P--xA: Sin respuesta
            A-->>C: 504 Gateway Timeout
        end
    end

```

La respuesta muestra el estado del producto al momento de la consulta. No implica una reserva de stock

### 3. Carga de producto

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant A as API
    participant DB as Registro de operaciones
    participant P as Servicio externo

    C->>A: POST /products
    A->>A: Validar producto y autorización

    alt Datos inválidos
        A-->>C: 400 Bad Request
    else Datos válidos
        A->>DB: Registrar operación PENDING
        DB-->>A: operationId
        A->>P: POST /upload/product

        alt Respuesta 200
            P-->>A: Producto cargado
            A->>DB: Actualizar estado a CONFIRMED
            A-->>C: 201 Created + producto
        else Respuesta 401
            P-->>A: Credencial inválida o vencida
            A->>DB: Registrar AUTHENTICATION_ERROR
            A-->>C: 502 Bad Gateway
        else Respuesta 403
            P-->>A: Permiso insuficiente
            A->>DB: Registrar AUTHORIZATION_ERROR
            A-->>C: 502 Bad Gateway
        else Error 5xx del proveedor
            P-->>A: Error interno
            A->>DB: Actualizar estado a UNKNOWN
            A-->>C: 502 Bad Gateway
        else Timeout
            P--xA: Resultado desconocido
            A->>DB: Actualizar estado a UNKNOWN
            A-->>C: 504 Gateway Timeout
        end
    end
```

Una carga con estado UNKNOWN no debe repetirse automáticamente porque podría duplicar el producto. Antes de reintentar se debe consultar el resultado o utilizar la misma clave de idempotencia, si el proveedor ofrece ese mecanismo

## 4. Consideraciones de integración

- Utilizar HTTPS, aunque las URLs de la consigna están expresadas con HTTP
- Aplicar mecanismo de autenticación definido por el proveedor y almacenar las credenciales de forma segura
- Configurar tiempos máximos de conexión y respuesta.
- Registrar operationId, endpoint, fecha, resultado y código externo e identificador de correlación
- No guardar tokens, credenciales ni información sensible en los logs
- No reintentar automáticamente errores funcionales como PD-001, PD-002, PD-003, 400 o 403
- Reintentar errores transitorios únicamente cuando la operación sea segura o el proveedor admita idempotencia
- Reconciliar las operaciones que hayan quedado en estado PENDING o UNKNOWN