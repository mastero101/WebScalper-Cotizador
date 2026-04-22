# WebScalper Node - Guía de Configuración

Este proyecto es un script de scraping de alto rendimiento diseñado para monitorear precios de componentes tecnológicos en diversas tiendas (Cyberpuerta, Amazon, Pcel, etc.) y sincronizar los datos con una base de datos MySQL.

## Configuración del Entorno (.env)

El proyecto utiliza variables de entorno para gestionar la configuración sensible (como credenciales de base de datos) de forma segura y flexible.

### ¿Por qué es necesario el archivo `.env`?

1. **Seguridad**: Evita que credenciales sensibles (usuarios, contraseñas, hosts) se suban al control de versiones (Git/GitHub). El archivo `.env` está incluido en el `.gitignore`.
2. **Portabilidad**: Permite cambiar la configuración según el entorno (desarrollo, pruebas, producción) sin modificar el código fuente.
3. **Estándar de la Industria**: Es la forma recomendada en aplicaciones Node.js para manejar configuraciones externas.

### Estructura del archivo `.env`

Crea un archivo llamado `.env` en la raíz del proyecto con la siguiente estructura:

```env
# Database Configuration
DB_HOST=tu_host_de_base_de_datos
DB_USER=tu_usuario
DB_PASSWORD=tu_contraseña
DB_NAME=tu_nombre_de_base_de_datos
DB_PORT=3306
DB_SSL=false
```

### Descripción de las variables

| Variable | Descripción |
| :--- | :--- |
| `DB_HOST` | Dirección IP o dominio del servidor MySQL. |
| `DB_USER` | Nombre de usuario para la conexión. |
| `DB_PASSWORD` | Contraseña del usuario de la base de datos. |
| `DB_NAME` | Nombre de la base de datos que contiene la tabla `componentes`. |
| `DB_PORT` | Puerto de conexión (por defecto es 3306). |
| `DB_SSL` | Define si la conexión requiere SSL (`true` o `false`). |

---

## Instalación y Uso

1. **Clonar el repositorio.**
2. **Instalar dependencias**:
   ```bash
   npm install
   ```
3. **Configurar el archivo `.env`** siguiendo la guía anterior.
4. **Ejecutar el script**:
   ```bash
   node scalper.js
   ```

## Solución de Problemas en VPS (Linux)

Si recibes errores como `Failed to launch the browser process` o `Syntax error: Unterminated quoted string`, es probable que la instalación de Chrome esté corrupta o falten dependencias. Ejecuta los siguientes comandos en tu servidor:

1. **Limpiar caché corrupta**:
   ```bash
   rm -rf /root/.cache/puppeteer
   ```

2. **Reinstalar el navegador**:
   ```bash
   npx puppeteer browsers install chrome
   ```

3. **Instalar dependencias del sistema**:
   ```bash
   sudo apt-get update && sudo apt-get install -y ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils
   ```

---

## Notas de Seguridad

> [!IMPORTANT]
> Nunca compartas ni subas tu archivo `.env` a repositorios públicos. Asegúrate de que permanezca listado en el archivo `.gitignore`.
