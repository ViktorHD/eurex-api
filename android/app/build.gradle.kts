plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.eurexapi.explorer"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.eurexapi.explorer"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("webassets"))
}

// The app is the web Explorer (plain ES modules, no build step): copy it into the APK's assets.
// Tests, screenshots and the Android project itself stay out.
val copyWebApp by tasks.registering(Sync::class) {
    from(rootProject.file("../index.html"))
    from(rootProject.file("../explorer")) {
        into("explorer")
        exclude("tests/**", "*.png")
    }
    into(layout.buildDirectory.dir("webassets"))
}
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(copyWebApp)
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
