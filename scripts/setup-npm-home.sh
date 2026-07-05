#!/bin/bash
DEFAULT_PATH="C:/DEV/WSB/BIN/NODE_NPM"
NPM_HOME_VAL="${1:-$DEFAULT_PATH}"

echo "Setting NPM_HOME to $NPM_HOME_VAL..."

# Export in current session
export NPM_HOME="$NPM_HOME_VAL"
export PATH="$NPM_HOME:$PATH"

# Persist to profile
PROFILE_FILE=""
if [ -f "$HOME/.bashrc" ]; then
    PROFILE_FILE="$HOME/.bashrc"
elif [ -f "$HOME/.profile" ]; then
    PROFILE_FILE="$HOME/.profile"
elif [ -f "$HOME/.bash_profile" ]; then
    PROFILE_FILE="$HOME/.bash_profile"
fi

if [ -n "$PROFILE_FILE" ]; then
    # Check if already added
    if ! grep -q "export NPM_HOME=" "$PROFILE_FILE"; then
        echo "" >> "$PROFILE_FILE"
        echo "export NPM_HOME=\"$NPM_HOME_VAL\"" >> "$PROFILE_FILE"
        echo "export PATH=\"\$NPM_HOME:\$PATH\"" >> "$PROFILE_FILE"
        echo "Persisted NPM_HOME to $PROFILE_FILE"
    fi
else
    echo "Could not find a standard profile file (.bashrc, .profile, etc.) to persist the environment variables."
fi

echo "Environment variable NPM_HOME has been set."
