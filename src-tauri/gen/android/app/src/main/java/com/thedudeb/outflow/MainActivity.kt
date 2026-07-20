package com.thedudeb.outflow

import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import com.google.android.material.snackbar.Snackbar
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability

class MainActivity : TauriActivity() {
  private lateinit var appUpdateManager: AppUpdateManager
  private var updatePromptedThisSession = false
  private var updateReadySnackbar: Snackbar? = null
  private val updateLauncher = registerForActivityResult(
    ActivityResultContracts.StartIntentSenderForResult()
  ) { }
  private val updateListener = InstallStateUpdatedListener { state ->
    if (state.installStatus() == InstallStatus.DOWNLOADED) showUpdateReady()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    appUpdateManager = AppUpdateManagerFactory.create(this)
    appUpdateManager.registerListener(updateListener)
  }

  override fun onResume() {
    super.onResume()
    checkForPlayUpdate()
  }

  override fun onDestroy() {
    updateReadySnackbar?.dismiss()
    appUpdateManager.unregisterListener(updateListener)
    super.onDestroy()
  }

  private fun checkForPlayUpdate() {
    if (BuildConfig.DEBUG) return
    appUpdateManager.appUpdateInfo.addOnSuccessListener { info ->
      if (info.installStatus() == InstallStatus.DOWNLOADED) {
        showUpdateReady()
        return@addOnSuccessListener
      }
      if (
        !updatePromptedThisSession &&
        info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE &&
        info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)
      ) {
        updatePromptedThisSession = true
        runCatching {
          appUpdateManager.startUpdateFlowForResult(
            info,
            updateLauncher,
            AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build()
          )
        }
      }
    }
  }

  private fun showUpdateReady() {
    if (updateReadySnackbar?.isShown == true || isFinishing || isDestroyed) return
    updateReadySnackbar = Snackbar
      .make(findViewById(android.R.id.content), "Outflow update ready", Snackbar.LENGTH_INDEFINITE)
      .setAction("Restart") { appUpdateManager.completeUpdate() }
    updateReadySnackbar?.show()
  }
}
