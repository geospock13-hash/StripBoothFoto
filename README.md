# StripBoothFoto · Android (APK)

Versión Android de la cabina de fotos **StripBoothFoto** de **ArtefGo Studio Labs**.

Reutiliza la interfaz web de la versión de PC (cámara, diseño de tira, composición) envuelta con **Capacitor**. En Android **no se imprime**: en su lugar, cada sesión **guarda las fotos en el dispositivo**:

- La **tira final** compuesta → `Documentos/StripBoothFoto/<nombre del evento>/tira_*.jpg`
- Las **fotos individuales** → `Documentos/StripBoothFoto/<nombre del evento>/originales/original_*.jpg`

El cliente luego copia esa carpeta a la PC.

## Cómo obtener el APK (sin instalar nada)

El APK se compila solo en **GitHub Actions**:

1. Entra a la pestaña **Actions** de este repositorio.
2. Abre la ejecución más reciente de **"Compilar APK (Android)"**.
3. Al terminar (verde), descarga el artefacto **`StripBoothFoto-APK`**.
4. Descomprímelo, pásalo a tu teléfono Android e instálalo (activa "instalar apps desconocidas").

También puedes dispararlo manualmente en **Actions → Compilar APK (Android) → Run workflow**.

## Estructura

- `www/` — la interfaz (reutilizada de la versión PC).
  - `recursos/android-shim.js` — adaptador que reemplaza el servidor interno por almacenamiento del dispositivo y define los puentes de Android.
- `capacitor.config.json` — configuración de la app (ID, nombre).
- `.github/workflows/build-apk.yml` — compilación automática del APK.

La carpeta `android/` se genera en la nube durante la compilación (no se versiona).

## Pendiente (siguientes fases)

- Selector de carpeta del usuario (Android SAF) para elegir dónde guardar.
- Suscripción por Google Play (Billing) — mensual / anual.
- Ajustes finos de la pantalla de resultado (quitar el QR de descarga de PC).
