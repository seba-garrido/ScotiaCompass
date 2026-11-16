# Scotia Compass

Workspace MongoDB con logos oficiales de Scotiabank, cabecera roja y temas claro y oscuro. Proyecto independiente del pipeline ETL: no modifica su código, credenciales ni ejecución.

El selector **Claro / Oscuro** de la cabecera aplica a todo el workspace, incluidos formularios, tablas y editores. Recuerda la elección en este navegador y usa la preferencia del sistema en la primera visita. Cambiar de tema conserva las consultas en edición. Los SVG se sirven localmente; sus fuentes oficiales están documentadas en [web/assets/SOURCES.md](web/assets/SOURCES.md).

## Iniciar

Requiere Node.js 22 o posterior.

```powershell
npm ci
npm run dev
```

Abre **http://127.0.0.1:4317**. El workspace parte vacío. No se cargan conexiones de ejemplo ni se importan URI del entorno. La aplicación se compila en `dist/` y el backend sirve la UI y `/api` en el mismo origen.

## Conectar Anthos y Atlas

1. Presiona **Nueva conexión**.
2. Personaliza el nombre y color; elige proveedor y ambiente, e ingresa la URI. La base es opcional, útil si tu usuario no puede listar todas las bases.
3. Presiona **Probar y conectar**. El servidor verifica la conexión y un ping. Solo cuando ambos funcionan y se guarda el perfil, aparece en el listado. Un intento fallido conserva el formulario y no agrega conexiones.
4. **Desconectar** cierra el cliente MongoDB y conserva la configuración. No se puede consultar ni escribir hasta presionar **Conectar** nuevamente.
5. **Conectar** reutiliza la URI guardada, sin pedirla otra vez. Si falla, el perfil permanece desconectado y se puede reintentar o editar.
6. **Editar** permite cambiar nombre, color, ambiente, base o URI. Deja la URI vacía para conservar la anterior. Los cambios se guardan después de conectar correctamente.
7. **Eliminar conexión**, con confirmación, borra exclusivamente el perfil guardado. No elimina datos de MongoDB.

## Persistencia de conexiones

Las conexiones sobreviven al reinicio del backend y arrancan **desconectadas**, sin conexiones automáticas. El catálogo y las URI se cifran con AES-256-GCM en `connections.enc`. La clave aleatoria de 256 bits se conserva en `connections.key`, en el mismo directorio privado del servidor. Las URI no se devuelven al navegador, no se incluyen en logs y no se guardan en localStorage.

El directorio predeterminado es `%LOCALAPPDATA%/ScotiaCompass` en Windows y `~/.local/share/ScotiaCompass` en otros sistemas. Puedes cambiarlo con `SCOTIA_DATA_DIR` en `.env` (copia `.env.example`). Restringe este directorio a la cuenta del servicio; quien tenga acceso al catálogo **y** a la clave puede descifrarlo. Los modos Unix son 0700/0600; en Windows se heredan los permisos del directorio del usuario. Conserva ambos archivos en los respaldos y evita carpetas públicas o sincronizadas. Si se pierde o corrompe la clave, el servidor informa el error sin sobrescribir el catálogo. Usa una sola instancia Node por directorio de datos.

El **servidor Node debe alcanzar ambos MongoDB**: VPN/rutas/DNS/firewall y acceso de Atlas según la red corporativa. Una interfaz no resuelve una ruta de red ausente. Usa las opciones TLS, replicaSet y authSource que correspondan en cada URI. No se desactiva la verificación TLS. El driver oficial reutiliza un pool por conexión ([MongoClient](https://www.mongodb.com/docs/drivers/node/current/connect/mongoclient/)).

## Funcionalidad

- Conexiones por ambiente y proveedor; búsqueda, filtros de ambiente y exploración de bases/colecciones.
- Consultas `find` con filtro, orden y proyección JSON, paginación de 10–100 documentos, timeout de 10 segundos y salto máximo 100.000. Para páginas profundas usa rangos por `_id` con un índice adecuado.
- Vista JSON y tabla; copia y exportación **de la página actual**, sin descargar una colección completa.
- Insertar, reemplazar o eliminar **un documento por operación**, conservando tipos BSON con Extended JSON canónico. Editor de documento completo; `_id` inmutable; rechazo ante una edición concurrente. Las proyecciones deshabilitan edición/eliminación hasta consultar el documento completo.
- Confirmación de eliminación y protección en producción. `ENABLE_PRODUCTION_WRITES=false` por defecto; para escribir en PROD se debe habilitar explícitamente en el servidor, tener una conexión editable y confirmar el nombre de la colección en cada operación.
- Lectura de índices, campos/tipos de la muestra actual, consultas guardadas e historial durante la sesión. No se persisten filtros ni documentos de MongoDB en el navegador.
- Conteo estimado de documentos; puede diferir del valor exacto durante escrituras. El esquema se deriva solo de la página consultada.

El filtro es JSON, **no JavaScript de mongosh**. Usa `{ "_id": { "$oid": "69150000a8f2d604b7100000" } }` y `{ "created_at": { "$gte": { "$date": "2026-11-01T00:00:00Z" } } }`. No se aceptan `$where`, `$function` ni `$accumulator`. La demo ejecuta filtros con Mingo, mientras que el modo real delega en MongoDB; no son motores idénticos.

## Desplegar internamente

Esta versión es para **un operador o un workspace compartido con la misma autorización**, no tiene permisos individuales por usuario. En loopback puede usarse sin clave. Para escuchar en red, configura `APP_ACCESS_TOKEN` con al menos 24 caracteres, `HOST=0.0.0.0` y `APP_ORIGIN` con el origen visible exacto. La sesión usa cookie HttpOnly y SameSite Strict, vence a las 8 horas y usa Secure cuando APP_ORIGIN es HTTPS. Todas las solicitudes API requieren la cabecera del cliente y un Host/Origin permitido. No se habilita CORS.

Para un uso corporativo compartido, integra SSO/RBAC y auditoría por usuario en el proxy/backend antes de ampliar el acceso. Usa HTTPS y un gestor de secretos; las credenciales MongoDB determinan los permisos finales. Los errores se sanitizan para no exponer URI ni valores de documentos. La auditoría de escrituras exitosas se emite como JSON a stdout con acción, conexión, base, colección y resultado; no es un registro por usuario ni a prueba de alteraciones.

```powershell
# Define APP_ACCESS_TOKEN en .env antes de iniciar Docker.
docker compose up --build -d
```

El compose publica solo en `127.0.0.1:4317`, usa un usuario sin privilegios y un filesystem de solo lectura, con el volumen persistente `scotia_connections` montado en `/app/data` para guardar conexiones y su clave. No elimines ese volumen si quieres conservarlas. La imagen requiere clave porque escucha dentro del contenedor en 0.0.0.0. Para un clúster interno, usa una réplica con almacenamiento persistente e ingress HTTPS; APP_ORIGIN debe coincidir con el Host que recibe Node. Certificados corporativos adicionales pueden montarse y configurarse con `NODE_EXTRA_CA_CERTS`.

## Demo publicada y alcance

La versión en Sites contiene **solo el frontend**, comienza sin conexiones y permite probar el mismo flujo con **Simular conexión**. Se configura un nombre, proveedor, ambiente y color con una URI ficticia no editable. El perfil de demo se guarda en este navegador, siempre sin URI ni credenciales. Al recargar aparece desconectado. Los documentos ficticios y sus cambios duran la sesión. Para conectar MongoDB real, ejecuta el backend local o interno; allí el formulario sí acepta la URI. No se publicaron credenciales ni documentos del ETL.

Esta implementación cubre el explorador y CRUD solicitado; no replica todo MongoDB Compass. No incluye agregaciones, editor de índices, administración de usuarios, shell, operaciones masivas ni creación/eliminación de bases o colecciones. Máximo de documento aceptado por la API: 2 MB, menor que el límite nativo de MongoDB. El pipeline registra checkpoints y auditoría en SQL Server: esta consola no es un monitor de avance ni verifica integridad de una migración.

## Verificación

```powershell
npm test
npm run test:ui
```

Las pruebas API usan una instancia MongoDB efímera aislada (mongodb-memory-server descarga su binario en la primera ejecución), nunca tus bases. Verifican CRUD, BSON, conflictos, permisos, límites, autenticación y el ciclo de conexiones: alta exitosa/fallida, desconexión, reconexión, persistencia cifrada, reinicio, edición y eliminación. Las pruebas UI usan un servidor de prueba en el puerto 4327 y MongoDB temporal; no usan el catálogo de conexiones del usuario. Utilizan Chrome instalado; `PLAYWRIGHT_CHANNEL=msedge` permite usar Edge. El build no necesita navegador.
