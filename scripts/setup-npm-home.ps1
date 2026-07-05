$defaultPath = "C:\DEV\WSB\BIN\NODE_NPM"
$npmHomeVal = if ($args.Count -ge 1) { $args[0] } else { $defaultPath }

Write-Host "Setting NPM_HOME to $npmHomeVal..."
[Environment]::SetEnvironmentVariable("NPM_HOME", $npmHomeVal, [EnvironmentVariableTarget]::User)

# Update current session variables
$env:NPM_HOME = $npmHomeVal
$env:PATH = "$npmHomeVal;" + $env:PATH

Write-Host "Environment variable NPM_HOME has been set successfully."
Write-Host "Please restart your PowerShell session to apply changes globally."
