import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val releaseKeystorePath = System.getenv("OUTFLOW_ANDROID_KEYSTORE_PATH")?.takeIf { it.isNotEmpty() }
val releaseKeystorePassword = System.getenv("OUTFLOW_ANDROID_KEYSTORE_PASSWORD")?.takeIf { it.isNotEmpty() }
val releaseKeyAlias = System.getenv("OUTFLOW_ANDROID_KEY_ALIAS")?.takeIf { it.isNotEmpty() }
val releaseKeyPassword = System.getenv("OUTFLOW_ANDROID_KEY_PASSWORD")?.takeIf { it.isNotEmpty() }
val releaseSigningValues = listOf(releaseKeystorePath, releaseKeystorePassword, releaseKeyAlias, releaseKeyPassword)
val releaseSigningConfigured = releaseSigningValues.count { it != null }

if (releaseSigningConfigured != 0 && releaseSigningConfigured != releaseSigningValues.size) {
    throw GradleException("Android release signing requires a complete Outflow signing environment.")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    signingConfigs {
        if (releaseSigningConfigured == releaseSigningValues.size) {
            create("outflowRelease") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseKeystorePassword!!
                keyAlias = releaseKeyAlias!!
                keyPassword = releaseKeyPassword!!
            }
        }
    }
    compileSdk = 36
    namespace = "com.thedudeb.outflow"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.thedudeb.outflow"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".debug"
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (releaseSigningConfigured == releaseSigningValues.size) {
                signingConfig = signingConfigs.getByName("outflowRelease")
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
