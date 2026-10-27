# Speaks every number a rest needs into sounds/<n>.wav with a Windows voice.
# These are stand-ins until the real recordings replace them; run tools/build.mjs afterwards.
#   powershell -File tools/placeholder-sounds.ps1 [-Voice "Microsoft Zira Desktop"]

param(
  [string]$Voice = 'Microsoft Zira Desktop'
)

Add-Type -AssemblyName System.Speech

$sounds = Join-Path (Split-Path -Parent $PSScriptRoot) 'sounds'
New-Item -ItemType Directory -Force $sounds | Out-Null

# The same numbers as rest.js: 0-10 for the countdown, and 30 and 60 seconds left.
$numbers = @(0..10) + @(30, 60)

$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.SelectVoice($Voice)
$speaker.Rate = 1
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

foreach ($n in $numbers) {
  $speaker.SetOutputToWaveFile((Join-Path $sounds "$n.wav"), $format)
  $speaker.Speak("$n")
}
$speaker.SetOutputToNull()
$speaker.Dispose()
Write-Output "$($numbers.Count) placeholder sounds in $sounds"
