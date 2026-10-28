# Vertikal CRM

CRM personal de tareas y clientes, hecho como PWA (funciona en escritorio y se instala en Android). Reemplaza la lógica de **CM NOTES 2026**: Inbox, Today Tasks, Overdue, Quick Access, hojas mensuales y RECURRENTES.

## Qué hace

| Necesidad | Cómo lo resuelve |
|---|---|
| Crear tareas y asignarlas a clientes | Botón **Nueva tarea** (o tecla `N`). Cliente, categoría, prioridad, estado, fecha y hora límite |
| Avisos de atrasadas | Notificación del sistema por cada tarea que vence, contador en el ícono de la app y sección **Atrasadas** |
| Control de desarrollo y terminadas | Estados Pendiente, En desarrollo, Seguimiento y Terminada. Vista Lista agrupada por fecha o Tablero con arrastrar y soltar |
| Fecha y hora | Cada tarea guarda **Ingresada**, **Iniciada** y **Finalizada** con fecha y hora, más un historial de actividad |
| Clientes | Agregar, editar color, archivar o eliminar. Cada cliente tiene su carpeta de Drive y sus métricas |
| Recurrentes mensuales | Plantillas con los días del mes en que vencen. El **último día de cada mes** se generan las del mes siguiente. También puedes generarlas manualmente |
| Dashboard | KPIs, Hoy, Atrasadas, próximas reuniones, terminadas en 14 días, carga por cliente y accesos rápidos |
| Reuniones | **Agendar reunión** crea el evento en Google Calendar con Meet e invitados, y lo vincula a la tarea |
| Google Tasks y widget de Android | Lista “Vertikal CRM”: ves lo de hoy (hecho y pendiente) y lo que marques en el teléfono se marca en el CRM, y viceversa |
| Inbox desde Google Tasks | Lo que crees en esa lista desde el teléfono llega al **Inbox** para darle cliente, fecha y detalles |
| Correo nuevo | El Apps Script incluido crea “Revisar correo: asunto” por cada correo nuevo, con enlace al correo |
| Documentos y archivos | Enlaza Docs, Sheets, Slides, PDF y carpetas (detecta el tipo y lee el nombre del archivo). Sube archivos por tarea a tu Drive |
| Subtareas y notas | Dentro de cada tarea: notas, subtareas con fecha de finalización, enlaces, archivos y actividad |

Atajos: `/` buscar, `N` nueva tarea, `I` capturar en Inbox, `Esc` cerrar detalle.

## Instalación (una sola vez, unos 20 minutos)

### 1. Publicar en GitHub Pages

1. Crea un repositorio, por ejemplo `vertikal-crm`, y sube **todo el contenido** de esta carpeta (la raíz debe tener `index.html`).
2. En el repositorio: **Settings › Pages › Build and deployment**: Source “Deploy from a branch”, rama `main`, carpeta `/ (root)`.
3. Tu URL será `https://TU-USUARIO.github.io/vertikal-crm/`. Ábrela una vez para confirmar que carga (funciona en modo local aunque falte el paso 2).

### 2. Configurar Google Cloud

1. Entra a [console.cloud.google.com](https://console.cloud.google.com) con tu cuenta de Vertikal y crea el proyecto **Vertikal CRM**.
2. **APIs y servicios › Biblioteca**: habilita **Google Tasks API**, **Google Calendar API** y **Google Drive API**.
3. **Pantalla de consentimiento de OAuth**: elige **Interno** (solo cuentas de vertikalcompany.com, sin verificación de Google). Si no te deja, elige Externo, déjala en modo prueba y agrega tu correo en **Usuarios de prueba**.
4. **Credenciales › Crear credenciales › ID de cliente de OAuth**:
   * Tipo: **Aplicación web**
   * Orígenes autorizados de JavaScript: `https://TU-USUARIO.github.io`
5. Copia el **ID de cliente** y pégalo en `js/config.js`:
   ```js
   GOOGLE_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
   ```
6. Sube el cambio a GitHub. En la app: **Ajustes › Conectar Google** y acepta los permisos.

Si el Workspace de Vertikal bloquea apps de terceros, el administrador debe permitir este ID de cliente en **Admin › Seguridad › Controles de API**.

### 3. Instalar la app

* **Android**: abre la URL en Chrome › menú ⋮ › **Instalar app**. Luego en **Ajustes › Notificaciones › Activar**.
* **Escritorio**: Chrome o Edge muestran el ícono de instalar en la barra de direcciones.

### 4. Widget de Android

1. Instala la app **Google Tasks** en el teléfono.
2. Mantén presionada la pantalla de inicio › **Widgets › Tasks** y elige la lista **Vertikal CRM**.

### 5. Correos → tarea “Revisar correo”

1. Ve a [script.google.com](https://script.google.com) › **Nuevo proyecto** y pega el contenido de `apps-script/Code.gs`.
2. En **Servicios (+)** agrega **Google Tasks API**.
3. Selecciona la función `setup` y presiona **Ejecutar**. Acepta los permisos.

Desde ese momento revisa Gmail cada 5 minutos, aunque el CRM esté cerrado. Por defecto solo toma correos **no leídos de la pestaña Principal** (`CONFIG.QUERY`) y marca la tarea como hecha cuando lees o archivas el correo (`AUTO_COMPLETE_WHEN_READ`). El CRM intenta asignar el cliente si su nombre aparece en el asunto o el remitente.

### 6. Traer tus datos de CM NOTES (opcional)

La app ya trae tus 12 clientes, las 8 categorías, las 12 plantillas de RECURRENTES, las tareas pendientes de octubre y noviembre y tus accesos rápidos (solo falta pegar el enlace de cada uno). Para traer meses completos: en Sheets abre la hoja del mes › **Archivo › Descargar › CSV**, y en el CRM **Ajustes › Importar CSV** indicando el mes.

## Cómo funciona la sincronización

* **Datos**: un archivo JSON privado en tu Google Drive (carpeta oculta de la app). Cada dispositivo guarda copia local, así que también funciona sin conexión. Si editas en la PC y en el teléfono, se combinan registro por registro (gana el cambio más reciente).
* **Google Tasks** (lista “Vertikal CRM”):
  * Recibe las tareas pendientes de hoy, las atrasadas y las terminadas hoy (en Ajustes puedes incluir mañana o la semana).
  * Cada tarea lleva una etiqueta `#crm:id` en las notas; no la borres.
  * Marcar en el teléfono ↔ marcar en el CRM, en ambos sentidos. La hora de finalización queda registrada.
  * Tarea creada en el teléfono sin etiqueta → entra al **Inbox** del CRM y sale de la lista hasta que le asignes fecha.
  * Al día siguiente se limpian las terminadas del día anterior.
  * Google Tasks solo acepta fecha (no hora): la hora límite vive en el CRM y aparece en las notas.
* **Recurrentes**: el último día del mes, al abrir la app, se generan las tareas del mes siguiente. Si no la abriste ese día, al abrirla en el mes nuevo se generan las fechas que todavía no pasan. No se duplican aunque uses varios dispositivos.
* **Archivos subidos**: van a `Mi unidad › Vertikal CRM · Adjuntos › Cliente`.
* **Sesión de Google**: el permiso dura una hora; después se renueva solo con tu siguiente clic en la app (puede aparecer y cerrarse una ventanita de Google).

## Notificaciones

* Con la app abierta (o en segundo plano reciente) avisa en el momento en que una tarea vence.
* Con la app instalada en Android, Chrome revisa periódicamente las atrasadas aunque esté cerrada. La frecuencia la decide Chrome (aproximadamente cada hora o más, según el uso), así que no es al minuto exacto.
* Para un aviso al minuto en el teléfono, el widget y las notificaciones de Google Tasks muestran las tareas del día.

## Estructura

```
index.html            Interfaz y set de íconos SVG
css/app.css           Material 3 Expressive, tema Vertikal claro y oscuro (Inter 400/600/700)
js/config.js          ID de cliente OAuth y nombres de lista/carpeta
js/app.js             Vistas, detalle de tarea, diálogos, notificaciones
js/store.js           Modelo de datos, recurrentes, importación CSV, fusión
js/sync.js            Sincronización Drive + Google Tasks
js/google.js          OAuth y APIs (Drive, Tasks, Calendar)
sw.js                 Service worker: offline y avisos en segundo plano
apps-script/Code.gs   Gmail → Google Tasks
icons/                Íconos generados a partir del logo de Vertikal
```

Los íconos de la app se generaron desde el PNG del logo. Si tienes el isotipo en SVG o PNG grande, reemplaza `icons/icon-*.png`, `icons/maskable-*.png` y `icons/mark.png` para que se vean más nítidos.

Para publicar una actualización, sube los archivos a GitHub y cambia `VERSION` en `sw.js` para que los teléfonos tomen la versión nueva.

## Versión 2

| Función | Cómo funciona |
|---|---|
| Códigos por mes | `T` + mes + año + consecutivo: **T1026001** es la tarea 1 creada en octubre 2026. El consecutivo indica cuántas tareas se crearon en el mes. Las recurrentes toman el mes en que vencen |
| Archivo mensual | Desde el último día del mes aparece **Archivar mes** (en Inicio y en Archivo) y se queda visible hasta que lo archives. Guarda las tareas terminadas tal como están, en solo lectura, en tu Drive |
| Pendientes | Al archivar, lo que no se terminó sigue activo y pasa al mes siguiente con la marca “De oct” |
| Mi semana | Lunes a domingo con tus tareas y reuniones. Arrastra una tarea (ícono de puntos) a otro día para cambiar su fecha |
| Orden manual | Arrastra el ícono de puntos en Inicio o en Tareas para definir qué trabajas primero. Las terminadas no se reordenan |
| Estadísticas | Terminadas por cliente y categoría, entrega promedio, a tiempo y atrasadas, por mes o periodo |
| PDF | Archivo › PDF abre el reporte con marca Vertikal; elige “Guardar como PDF” |
| Sheets | Archivo › Sheets crea la hoja del mes en formato CM NOTES en Drive › Vertikal CRM · Exportaciones (requiere la API de Google Sheets habilitada en el proyecto) |
