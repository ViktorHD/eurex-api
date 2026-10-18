package com.eurexapi.explorer

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.util.Base64
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader

/**
 * Hosts the web Explorer. The app files are bundled in the APK and served from a secure
 * https origin (appassets.androidplatform.net), so ES modules, localStorage and the
 * clipboard behave as in a browser. Data comes from the Eurex API over the network.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .setDomain(APP_HOST)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
            )
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                // Assets are only reachable through the asset loader, never via file:// or content://
                allowFileAccess = false
                allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            }
            addJavascriptInterface(Bridge(), "AndroidBridge")
            webViewClient = Client()
            webChromeClient = WebChromeClient()
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 8)
            max = 100
        }
        setContentView(FrameLayout(this).apply {
            addView(webView)
            addView(progress)
        })

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        else webView.loadUrl(START_URL)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            assetLoader.shouldInterceptRequest(request.url)

        // Everything outside the bundled app (Developer Portal, eurex.com, ...) opens in the browser
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.scheme == "https" && url.host == APP_HOST) return false
            try {
                startActivity(Intent(Intent.ACTION_VIEW, url))
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "No app can open this link", Toast.LENGTH_SHORT).show()
            }
            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            progress.visibility = ViewGroup.VISIBLE
        }

        override fun onPageFinished(view: WebView, url: String) {
            progress.visibility = ViewGroup.GONE
            view.evaluateJavascript(NATIVE_HOOKS, null)
        }
    }

    /** Called from the page; all methods run on a WebView background thread. */
    private inner class Bridge {
        @JavascriptInterface
        fun saveFile(fileName: String, mimeType: String, base64: String) {
            val name = fileName.replace(Regex("[^A-Za-z0-9._-]+"), "_").ifEmpty { "download" }
            try {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, mimeType.ifEmpty { "application/octet-stream" })
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw IllegalStateException("Could not create file")
                resolver.openOutputStream(uri)?.use { it.write(Base64.decode(base64, Base64.DEFAULT)) }
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                toast("Saved to Downloads: $name")
            } catch (e: Exception) {
                toast("Could not save $name")
            }
        }

        @JavascriptInterface
        fun print() {
            runOnUiThread {
                val manager = getSystemService(PRINT_SERVICE) as PrintManager
                manager.print(
                    getString(R.string.app_name),
                    webView.createPrintDocumentAdapter(getString(R.string.app_name)),
                    PrintAttributes.Builder().build()
                )
            }
        }

        private fun toast(message: String) =
            runOnUiThread { Toast.makeText(this@MainActivity, message, Toast.LENGTH_LONG).show() }
    }

    companion object {
        private const val APP_HOST = "appassets.androidplatform.net"
        private const val START_URL = "https://$APP_HOST/index.html"

        // WebView ignores <a download> on blob: URLs and has no window.print(); route both to native code.
        // fetch() resolves the blob URL synchronously, so it still works after the page revokes the URL.
        private val NATIVE_HOOKS = """
            (function () {
                if (window.__eurexNative) return;
                window.__eurexNative = true;
                var click = HTMLAnchorElement.prototype.click;
                HTMLAnchorElement.prototype.click = function () {
                    var a = this;
                    if (a.hasAttribute('download') && /^blob:/.test(a.href)) {
                        var name = a.getAttribute('download') || 'download';
                        fetch(a.href).then(function (r) { return r.blob(); }).then(function (blob) {
                            var reader = new FileReader();
                            reader.onloadend = function () {
                                var s = String(reader.result);
                                AndroidBridge.saveFile(name, blob.type.split(';')[0], s.substring(s.indexOf(',') + 1));
                            };
                            reader.readAsDataURL(blob);
                        });
                        return;
                    }
                    return click.apply(a, arguments);
                };
                window.print = function () { AndroidBridge.print(); };
            })();
        """.trimIndent()
    }
}
