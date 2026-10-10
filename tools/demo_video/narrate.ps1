# Speak each scene's narration (tools/demo_video/script.json) to a WAV file with the
# built-in Windows voice. Offline, nothing to install.
#   powershell -NoProfile -File tools\demo_video\narrate.ps1 <output folder>
param([string]$Out = "$PSScriptRoot\out")
Add-Type -AssemblyName System.Speech
$script = Get-Content -Raw -Encoding UTF8 "$PSScriptRoot\script.json" | ConvertFrom-Json
New-Item -ItemType Directory -Force $Out | Out-Null
$durations = @{}
foreach ($scene in $script.scenes) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice($script.voice)
  $synth.Rate = 0
  $file = Join-Path $Out "$($scene.id).wav"
  $synth.SetOutputToWaveFile($file)
  $synth.Speak($scene.narration)
  $synth.Dispose()
  $bytes = [System.IO.File]::ReadAllBytes($file)
  $byteRate = [BitConverter]::ToInt32($bytes, 28)
  $durations[$scene.id] = [math]::Round(($bytes.Length - 44) / $byteRate, 2)
}
$durations | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Out "durations.json")
$durations | ConvertTo-Json
