package com.artefgo.stripboothfoto;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;

/**
 * FolderSaf: permite al usuario elegir una carpeta (Storage Access Framework)
 * y guardar / listar / leer / borrar archivos dentro de ella.
 * Esto reemplaza la impresión de la versión PC: las fotos del evento se guardan
 * en la carpeta que el usuario elija, y luego las copia a su computadora.
 */
@CapacitorPlugin(name = "FolderSaf")
public class FolderSaf extends Plugin {

    // --- Elegir carpeta ---
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri uri = result.getData().getData();
            try {
                int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            } catch (Exception ignored) {}
            DocumentFile d = DocumentFile.fromTreeUri(getContext(), uri);
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            ret.put("name", d != null && d.getName() != null ? d.getName() : "");
            call.resolve(ret);
        } else {
            call.reject("cancelado");
        }
    }

    // Navega (creando si hace falta) por subcarpetas "a/b/c" dentro del árbol dado.
    private DocumentFile dirPara(Uri treeUri, String subPath, boolean crear) {
        DocumentFile dir = DocumentFile.fromTreeUri(getContext(), treeUri);
        if (dir == null) return null;
        if (subPath == null) return dir;
        for (String part : subPath.split("/")) {
            if (part == null || part.isEmpty()) continue;
            DocumentFile next = dir.findFile(part);
            if (next == null || !next.isDirectory()) {
                if (!crear) return null;
                next = dir.createDirectory(part);
            }
            if (next == null) return null;
            dir = next;
        }
        return dir;
    }

    // --- Guardar un archivo (base64) en <carpeta>/<subPath>/<fileName> ---
    @PluginMethod
    public void saveFile(PluginCall call) {
        try {
            Uri tree = Uri.parse(call.getString("folderUri"));
            String subPath = call.getString("subPath", "");
            String fileName = call.getString("fileName");
            String dataB64 = call.getString("data");
            String mime = call.getString("mime", "image/jpeg");

            DocumentFile dir = dirPara(tree, subPath, true);
            if (dir == null) { call.reject("no se pudo crear la carpeta"); return; }

            DocumentFile existing = dir.findFile(fileName);
            if (existing != null) existing.delete();

            DocumentFile file = dir.createFile(mime, fileName);
            if (file == null) { call.reject("no se pudo crear el archivo"); return; }

            byte[] bytes = Base64.decode(dataB64, Base64.DEFAULT);
            OutputStream os = getContext().getContentResolver().openOutputStream(file.getUri());
            os.write(bytes);
            os.flush();
            os.close();

            JSObject ret = new JSObject();
            ret.put("uri", file.getUri().toString());
            ret.put("name", file.getName());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("error guardando: " + e.getMessage());
        }
    }

    // --- Listar archivos de <carpeta>/<subPath> ---
    @PluginMethod
    public void listFiles(PluginCall call) {
        try {
            Uri tree = Uri.parse(call.getString("folderUri"));
            String subPath = call.getString("subPath", "");
            DocumentFile dir = dirPara(tree, subPath, false);
            JSArray arr = new JSArray();
            if (dir != null) {
                for (DocumentFile f : dir.listFiles()) {
                    if (f.isFile()) {
                        JSObject o = new JSObject();
                        o.put("name", f.getName());
                        o.put("uri", f.getUri().toString());
                        o.put("size", f.length());
                        o.put("mtime", f.lastModified());
                        arr.put(o);
                    }
                }
            }
            JSObject ret = new JSObject();
            ret.put("files", arr);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("error listando: " + e.getMessage());
        }
    }

    // --- Leer un archivo por su uri y devolverlo en base64 (para miniaturas) ---
    @PluginMethod
    public void readFile(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri"));
            InputStream is = getContext().getContentResolver().openInputStream(uri);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
            is.close();
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("error leyendo: " + e.getMessage());
        }
    }

    // --- Borrar un archivo por su uri ---
    @PluginMethod
    public void deleteFile(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri"));
            DocumentFile f = DocumentFile.fromSingleUri(getContext(), uri);
            boolean ok = f != null && f.delete();
            JSObject ret = new JSObject();
            ret.put("ok", ok);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("error borrando: " + e.getMessage());
        }
    }

    // --- ¿Sigue válido el permiso de una carpeta elegida antes? ---
    @PluginMethod
    public void hasAccess(PluginCall call) {
        boolean ok = false;
        try {
            Uri tree = Uri.parse(call.getString("folderUri"));
            DocumentFile d = DocumentFile.fromTreeUri(getContext(), tree);
            ok = d != null && d.canWrite();
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }
}
