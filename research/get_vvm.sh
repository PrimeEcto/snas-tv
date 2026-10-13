#!/usr/bin/env bash

# Copyright 2025 Amazon.com, Inc. or its affiliates.  All rights reserved.
#
# These materials are licensed as "Program Materials" under the Program Materials
# License Agreement (the "Agreement").  The Agreement is available at
# https://developer.amazon.com/support/legal/pml.  See the Agreement for the
# specific terms and conditions of the Agreement.  Capitalized terms not defined
# in this file have the meanings given to them in the Agreement.
#
# If you do not agree to the above terms and conditions, you may not use any file
# in this package.
#
# YOUR USE OF THE PROGRAM MATERIALS IN OR ASSOCIATED WITH THIS PACKAGE IS AT
# YOUR SOLE RISK.  IN NO EVENT WILL AMAZON BE LIABLE FOR ANY DAMAGES, INCLUDING
# WITHOUT LIMITATION ANY DIRECT, INDIRECT, CONSEQUENTIAL, SPECIAL, INCIDENTAL,
# OR PUNITIVE DAMAGES (INCLUDING FOR ANY LOSS OF GOODWILL, BUSINESS INTERRUPTION,
# LOST PROFITS OR DATA, OR COMPUTER FAILURE OR MALFUNCTION) ARISING FROM OR
# RELATING TO SUCH PROGRAM MATERIALS, HOWEVER CAUSED AND REGARDLESS OF THE THEORY
# OF LIABILITY, EVEN IF AMAZON HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
# THESE LIMITATIONS AND DISCLAIMERS APPLY EXCEPT TO THE EXTENT PROHIBITED BY APPLICABLE LAW.

readonly BOLD=$(printf '\033[1m')
readonly UNBOLD=$(printf '\033[22m')

readonly SUCCESS=0
readonly ERROR=1
readonly QUIT=2
readonly WARNING=3

#region Execution environment
function set_strict_mode() {
    set -euo pipefail
}
function is_sourced() {
    # Handle case where BASH_SOURCE is not available
    if [[ -z "${BASH_SOURCE[0]:-}" ]]; then
        return $ERROR
    fi
    # Pipe to bash (stdin) or interactive shell
    if [[ "${0}" == "-bash" ]] || [[ "${0}" == "bash" ]] || [[ "${0}" =~ /bash$ ]] || [[ "${0}" == "-sh" ]] || [[ "${0}" == "main" ]]; then
        return $ERROR
    fi
    # Otherwise check if it's sourced
    if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
        return $ERROR
    else
        return $SUCCESS
    fi
}

function is_interactive() {
    # First check if NONINTERACTIVE is explicitly set

    if [[ "${NONINTERACTIVE:-false}" == "true" ]]; then
        log_debug "Noninteractive"
        return $ERROR
    fi

    # Then check tty access
    if [[ -e /dev/tty ]] && [[ -r /dev/tty ]] 2>/dev/null; then
        log_debug "Interactive"
        return $SUCCESS
    fi

    log_debug "Noninteractive"
    return $ERROR
}

# No Rosetta.
function is_running_natively() {
    if ! uname_path=$(command -v -p uname); then
        log_fatal "uname not found."
        return $ERROR
    fi
    if "$uname_path" -s | grep -q 'Darwin'; then
        if ! arm64_support=$(sysctl -n hw.optional.arm64 2>/dev/null); then
            # Command failed
            return $SUCCESS # Assume not ARM64/Rosetta if we can't check
        fi

        if [[ "$arm64_support" == "1" ]]; then
            # Continue with ARM64 checks
            if [[ "$(arch)" != "arm64" ]]; then
                return $ERROR
            fi
        fi
    fi
    return $SUCCESS
}
#endregion

#region Emoji/ASCII
function emoji_support() {
    # Test a simple emoji
    local test_emoji=$'\U0001F604' # 😄
    local test_result

    # Try to print the emoji and capture the output
    if ! test_result=$(printf "%s" "$test_emoji" 2>/dev/null); then
        return $ERROR
    fi

    # Check if the output matches the input
    if [[ "$test_result" == "$test_emoji" ]] && [[ ${#test_result} -eq 1 ]]; then
        return $SUCCESS
    fi
    return $ERROR
}
function set_emojis() {
    if [[ "${FORCE_ASCII:-}" == "true" ]] || ! emoji_support; then
        # ASCII
        readonly STARS="***"
        readonly RIGHT_ARROW="-->"
        readonly BLACK_CHECK="[OK]"
        readonly RED_X="[X]"
        readonly YELLOW_WARNING="[!]"
        readonly BLACK_BULLET="*"
        readonly BLACK_X="[X]"
        readonly ENTER="Enter"
    else
        # Unicode characters
        readonly STARS=$'\u2728'
        readonly RIGHT_ARROW=$'\u27A1\uFE0F'
        readonly BLACK_CHECK=$'\u2714'
        readonly RED_X=$'\u274c'
        readonly YELLOW_WARNING=$'\u26A0\uFE0F'
        readonly BLACK_BULLET=$'\u2022'
        readonly BLACK_X=$'\u2718'
    fi
    return $SUCCESS
}
set_emojis
#endregion

#region Trap cleanup
declare -a TEMP_FILES=()
declare -a TEMP_DIRS=()

function register_temp_file() {
    local file="$1"
    TEMP_FILES+=("$file")
    # Only log if logging is initialized
    if declare -F log_debug >/dev/null 2>&1 && [[ "${LOG_ENABLED:-false}" == "true" ]]; then
        log_debug "Registered temp file: $file"
    fi
}

function register_temp_dir() {
    local dir="$1"
    TEMP_DIRS+=("$dir")
    # Only log if logging is initialized
    if declare -F log_debug >/dev/null 2>&1 && [[ "${LOG_ENABLED:-false}" == "true" ]]; then
        log_debug "Registered temp dir: $dir"
    fi
}

function cleanup() {
    local signal="${1:-EXIT}"

    # Only log if logging is initialized
    if declare -F log_debug >/dev/null 2>&1 && [[ "${LOG_ENABLED:-false}" == "true" ]]; then
        log_debug "cleanup: trap (signal $signal)"
    fi

    # Clean up temporary files
    # Use parameter expansion that's safe in strict mode (set -u)
    for file in "${TEMP_FILES[@]+"${TEMP_FILES[@]}"}"; do
        if [[ -n "$file" && -f "$file" ]]; then
            if ! rm -f "$file" 2>/dev/null; then
                # Only log if logging is initialized
                if declare -F log_debug >/dev/null 2>&1 && [[ "${LOG_ENABLED:-false}" == "true" ]]; then
                    log_debug "Failed to remove temp file: $file"
                fi
            fi
        fi
    done

    # Clean up temporary directories
    # Use parameter expansion that's safe in strict mode (set -u)
    for dir in "${TEMP_DIRS[@]+"${TEMP_DIRS[@]}"}"; do
        if [[ -n "$dir" && -d "$dir" ]]; then
            if ! rm -rf "$dir" 2>/dev/null; then
                # Only log if logging is initialized
                if declare -F log_debug >/dev/null 2>&1 && [[ "${LOG_ENABLED:-false}" == "true" ]]; then
                    log_debug "Failed to remove temp dir: $dir"
                fi
            fi
        fi
    done

    # Close log on exit only if it was opened
    if [[ "$signal" == "EXIT" ]] && declare -F close_log >/dev/null 2>&1 && [[ "${LOG_ENABLED:-false}" == "true" ]]; then
        close_log
    fi
}
#endregion

#region Global variables
function set_globals() {
    # Set HOME_DIR - use HOME if available, otherwise try getent
    if [[ -n "${HOME:-}" ]]; then
        HOME_DIR="$HOME"
    else
        # Try to get home directory from getent
        if command -v getent >/dev/null 2>&1; then
            local getent_output
            if getent_output=$(getent passwd "$(whoami)" 2>/dev/null) && [[ -n "$getent_output" ]]; then
                HOME_DIR=$(echo "$getent_output" | cut -d: -f6)
            else
                HOME_DIR=""
            fi
        else
            HOME_DIR=""
        fi
    fi

    # ALWAYS set VEGA_DIR (unconditionally)
    if [[ -n "$HOME_DIR" ]]; then
        VEGA_DIR="${HOME_DIR}/vega"
    else
        VEGA_DIR="${TMPDIR:-/tmp}/vega"
        log_debug "HOME_DIR not available, using $VEGA_DIR"
    fi

    # Then set VVM_INSTALL_DIR if not already set
    if [[ -z "${VVM_INSTALL_DIR:-}" ]]; then
        VVM_INSTALL_DIR="${VEGA_DIR}/bin"
    fi

    KPM_BASE_URL="${KPM_BASE_URL:-https://k-artifactory-external.labcollab.net/artifactory/api/kpm/}"
    KPM_REPO="${KPM_REPO:-kpm-default-prod-local}"

    CURL=$(command -v curl 2>/dev/null)
    TAR=$(command -v tar 2>/dev/null)

    # Simple jq detection - prefer externally set JQ with full path, fallback to system jq
    # Also re-detect if JQ is set to just "jq" without a full path
    if [[ -z "${JQ:-}" ]] || [[ "${JQ:-}" == "jq" ]] || [[ "${JQ:-}" == *"/env/"* ]]; then
        JQ=$(command -v jq 2>/dev/null || true)
    fi
    PACKAGE_NAME="KeplerVersionManagerInstaller"
    PLATFORM=$(determine_platform || true)
    VERBOSE=${VERBOSE:-false}
    LOG_ENABLED=${LOG_ENABLED:-true}
    LOG_FILE=${LOG_FILE:-''}
    NONINTERACTIVE=${NONINTERACTIVE:-false}
    SKIP_SDK_INSTALL=${SKIP_SDK_INSTALL:-false}
    VEGA_SDK_VERSION=${VEGA_SDK_VERSION:-}
}

function log_globals() {
    log_debug "HOME=${HOME:-}"
    log_debug "HOME_DIR=${HOME_DIR:-}"
    log_debug "VEGA_DIR=$VEGA_DIR"
    log_debug "VVM_INSTALL_DIR=$VVM_INSTALL_DIR"
    log_debug "KPM_BASE_URL=$KPM_BASE_URL"
    log_debug "KPM_REPO=$KPM_REPO"
    log_debug "CURL=$CURL"
    log_debug "TAR=$TAR"
    log_debug "JQ=$JQ"
    log_debug "PACKAGE_NAME=$PACKAGE_NAME"
    log_debug "PLATFORM=$PLATFORM"
    log_debug "VERBOSE=$VERBOSE"
    log_debug "LOG_ENABLED=$LOG_ENABLED"
    log_debug "LOG_FILE=$LOG_FILE"
    log_debug "NONINTERACTIVE=$NONINTERACTIVE"
    log_debug "SKIP_SDK_INSTALL=$SKIP_SDK_INSTALL"
    log_debug "VEGA_SDK_VERSION=$VEGA_SDK_VERSION"
}

#endregion

#region Logging
function caller_info() {
    if [[ ${#FUNCNAME[@]} -lt 2 || ${#BASH_LINENO[@]} -lt 1 ]]; then
        echo "unknown:0"
        return $SUCCESS
    fi

    # Use parameter expansion with default values
    local calling_function="${FUNCNAME[1]:-unknown}"
    local line_number="${BASH_LINENO[0]:-0}"
    echo "$calling_function:$line_number"
    return $SUCCESS
}

function open_log() {
    local today
    today=$(date +%Y-%m-%d)
    local tmp_dir="${TMPDIR:-/tmp}"
    local trimmed_tmp_dir="${tmp_dir%/}"
    local subdir="vega/vvm"

    if [[ -z "$LOG_FILE" ]]; then
        # Check if HOME_DIR is set and writable (HOME_DIR is set in set_globals)
        if [[ -z "$HOME_DIR" ]] || [[ ! -w "$HOME_DIR" ]]; then
            log_dir="${trimmed_tmp_dir}/${subdir}"
        else
            log_dir="${HOME_DIR}/${subdir}"
        fi
        LOG_FILE="${log_dir}/vvm-$today.log"

    else
        # Use the provided log file path
        log_dir=$(dirname "$LOG_FILE") || return $ERROR
    fi

    # Try to create log directory
    if [[ ! -d "$log_dir" ]]; then
        mkdir -p "$log_dir" 2>/dev/null || {
            # Failed to create directory, try /tmp
            log_dir="${trimmed_tmp_dir}"
            LOG_FILE="$log_dir/vvm-$today.log"

            # If even /tmp fails, disable logging
            if [[ ! -w "$log_dir" ]]; then
                LOG_ENABLED=false
                return $WARNING
            fi
        }
    fi

    # Check if log directory is writable
    if [[ ! -w "$log_dir" ]]; then
        # Try /tmp as a last resort
        log_dir="$trimmed_tmp_dir/vvm"
        mkdir -p "$log_dir" 2>/dev/null || {
            LOG_ENABLED=false
            return $ERROR
        }

        LOG_FILE="$log_dir/vvm-$today.log"

        # If even /tmp fails, disable logging
        if [[ ! -w "$log_dir" ]]; then
            LOG_ENABLED=false
            return $ERROR
        fi
    fi

    LOG_ENABLED=true

    local message
    local formatted_level
    formatted_level=$(format_level "info")
    message="$formatted_level [$PACKAGE_NAME]: === Vega CLI Installer Log Started ==="

    if [[ ! -f "$LOG_FILE" ]]; then
        # create
        echo "$message" >"$LOG_FILE" 2>/dev/null || {
            LOG_ENABLED=false
            return $ERROR
        }
    else
        # append
        echo "$message" >>"$LOG_FILE" 2>/dev/null || {
            LOG_ENABLED=false
            return $ERROR
        }
    fi

    echo "Logging to $LOG_FILE"
    return $SUCCESS
}

function close_log() {
    log_info "=== Vega CLI Installer Log Ended ==="
    return $?
}

function format_level() {
    level="$1"
    # Format timestamp
    timestamp=$(date +"%Y-%m-%d %H:%M:%S")

    # Format level with fixed width (padding with spaces)
    printf -v formatted_level "%s %-5s" "$timestamp" "$level"
    echo "$formatted_level"
    return $SUCCESS
}

function log_message() {
    local level="$1"
    local message="$2"
    local timestamp

    # Print to console if verbose mode is enabled and level is debug
    if [[ "${VERBOSE:-false}" == "true" && "$level" == "debug" ]]; then
        echo "[DEBUG] $message" >&2
    fi

    # Skip if logging is disabled
    if [[ "${LOG_ENABLED:-false}" != "true" ]]; then
        return $SUCCESS
    fi

    # Ensure log file is still writable
    if [[ ! -w "$LOG_FILE" ]]; then
        echo "${LOG_FILE} not writeable" >&2
        LOG_ENABLED=false
    fi

    timestamp_level=$(format_level "$level")

    echo "$timestamp_level [$PACKAGE_NAME]: $message" >>"$LOG_FILE" 2>/dev/null || {
        LOG_ENABLED=false
    }
    # Handle failures gracefully.
    # Don't stop the whole script.
    return $SUCCESS
}

function log_fatal() {
    local message
    if [ $# -eq 0 ]; then
        # Read from stdin if no arguments provided (pipe case)
        message=$(cat)
    else
        # Use the provided argument
        message="$1"
    fi

    log_message "fatal" "$message"
    echo -e "${RED_X} $message" >&2
    return $SUCCESS
}

function log_info() {
    log_message "info" "$1"
}

function log_debug() {
    log_message "debug" "$1"
}
#endregion

#region Interactive input handling
function validate_yes_no_input() {
    local input="$1"
    local normalized

    # Trim whitespace and convert to lowercase
    normalized=$(printf '%s\n' "$input" | xargs | tr '[:upper:]' '[:lower:]')

    # Limit length to prevent abuse
    if [[ ${#normalized} -gt 10 ]]; then
        log_debug "Input too long: ${#normalized} characters"
        echo ""
        return $ERROR
    fi

    # Only allow safe yes/no responses and normalize to single letter
    case "$normalized" in
    y | yes)
        echo "y"
        return $SUCCESS
        ;;
    n | no)
        echo "n"
        return $SUCCESS
        ;;
    "")
        # Empty input - caller should use default
        echo ""
        return $SUCCESS
        ;;
    *)
        log_debug "Invalid yes/no input: $normalized"
        echo ""
        return $ERROR
        ;;
    esac
}

function read_input() {
    local question="${1:-"Enter input"}"
    local default="${2:-""}"
    local instructions="${3:-""}"
    local input
    local interrupted=0
    local original_trap

    log_debug "read_input"

    # Save the current INT trap
    original_trap=$(trap -p INT)

    # Set up a trap to catch Ctrl+C
    trap 'interrupted=1; echo ""; return $QUIT' INT

    # Non-interactive mode handling
    if ! is_interactive; then
        echo "$default"
        if [[ -n "$original_trap" ]]; then
            eval "$original_trap"
        else
            trap - INT
        fi
        return $SUCCESS
    fi

    # Build prompt (preserve existing newline)
    prompt="${RIGHT_ARROW} ${question}"

    # Only add instructions if they're provided
    if [ -n "$instructions" ]; then
        prompt="${prompt} (${instructions})"
    fi

    prompt="${prompt}: "

    # Print prompt without adding extra newline
    printf "%s" "$prompt" >&2

    # It is run directly; terminal device file exists and is readable.
    # Handles curl | bash case where script runs directly (not sourced)
    # but we want to read user input from actual terminal.
    if ! is_sourced && [[ -e /dev/tty ]] && [[ -r /dev/tty ]]; then
        if ! read -r input </dev/tty; then
            # Reading from /dev/tty fails in CI environments
            # so we assume this is the case and return the default.
            if [[ -n "$original_trap" ]]; then
                eval "$original_trap"
            else
                trap - INT
            fi
            echo "$default"
            return $SUCCESS
        fi
    else
        if ! read -r input; then
            if [[ -n "$original_trap" ]]; then
                eval "$original_trap"
            else
                trap - INT
            fi
            echo "$default"
            return $SUCCESS
        fi
    fi

    # Restore the original trap
    if [[ -n "$original_trap" ]]; then
        eval "$original_trap"
    else
        trap - INT
    fi

    # Check if we were interrupted
    if [[ $interrupted -eq 1 ]]; then
        log_debug "User interrupted with Ctrl+C"
        return $QUIT
    fi

    if [ -z "$input" ]; then
        echo "$default"
        return $SUCCESS
    fi

    echo "$input"
    return $SUCCESS
}
#endregion

# region VSCode Extension installation support functions
function _find_vscode_executable() {
    local default_mac_location="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"

    # Check default Mac location first (only on macOS)
    if [[ "$(uname -s)" == "Darwin" ]] && [[ -x "$default_mac_location" ]]; then
        vscode_path="$default_mac_location"
        log_debug "Found VSCode at default Mac location: $vscode_path"
        return $SUCCESS
    fi

    # Try to find code command in PATH
    if command -v code >/dev/null 2>&1; then
        local found_code
        if found_code=$(command -v code 2>/dev/null) && [[ -n "$found_code" ]] && [[ -x "$found_code" ]]; then
            vscode_path="$found_code"
            log_debug "Found VSCode in PATH: $vscode_path"
            return $SUCCESS
        fi
    fi

    log_debug "VSCode executable not found"
    return $ERROR
}

function _uninstall_existing_vscode_extensions() {
    local extensions_to_remove=("${deprecated_extensions[@]}" "${legacy_extensions[@]}" "amazon.kepler-studio")

    log_debug "Attempting to uninstall any previously installed extensions"

    for extension in "${extensions_to_remove[@]}"; do
        if "$vscode_path" --uninstall-extension "$extension" >/dev/null 2>&1; then
            log_debug "Uninstalled extension: $extension"
        else
            log_debug "Did not uninstall extension (may not be installed): $extension"
        fi
    done
}

function _install_vscode_extension_from_marketplace() {
    log_debug "Attempting to install extension $extension_name from VSCode Marketplace"

    if "$vscode_path" --force --install-extension "$extension_name" >/dev/null 2>&1; then
        log_debug "Successfully installed $extension_name from marketplace"
        return $SUCCESS
    else
        log_debug "Failed to install $extension_name from marketplace"
        return $ERROR
    fi
}
#endregion

#region progress bar functions

function show_progress_bar() {
    local label="$1"
    local percent="$2"
    local width=30

    local filled=$((percent * width / 100))
    local empty=$((width - filled))

    # Build the bar
    local bar=""
    if [ $filled -gt 0 ]; then
        bar=$(printf '=%.0s' $(seq 1 $filled))
    fi
    if [ $empty -gt 0 ]; then
        bar="${bar}$(printf -- '-%.0s' $(seq 1 $empty))"
    fi

    printf "\r%s [%s] %3d%%     " "$label" "$bar" "$percent"

    if [ "$percent" -eq 100 ]; then
        echo # newline when complete
    fi
}

function update_progress() {
    local label="$1"
    local target="$2"
    local current="$3"

    while [ "$current" -lt "$target" ]; do
        current=$((current + 1))
        show_progress_bar "$label" "$current"
        sleep 0.02
    done
    return "$current"
}
#endregion

#region utility functions
function to_lower() {
    echo "$1" | tr '[:upper:]' '[:lower:]'
}

# Get the vega environment directory
# Returns the directory where the vega env file should be stored
function get_vega_env_dir() {
    if [[ -n "${HOME_DIR:-}" ]]; then
        echo "$HOME_DIR/vega"
        return $SUCCESS
    elif [[ -n "${VEGA_DIR:-}" ]]; then
        echo "$VEGA_DIR"
        return $SUCCESS
    else
        log_debug "Error: Neither HOME_DIR nor VEGA_DIR is set"
        echo ""
        return $ERROR
    fi
}

#region  Main installation with overall progress
function install_vega_cli() {
    local version=$1
    local progress=0
    local label="Installing"

    download_link=$(get_vvm_download_link "$version")
    if [[ -z $download_link ]]; then
        echo "Error: Failed to get download link"
        return $ERROR
    fi

    log_debug "DOWNLOAD_LINK:  $download_link"

    # Create temporary directory (2%)
    show_progress_bar "$label" $progress
    temp_dir=$(mktemp -d)
    if [[ ! -d "$temp_dir" ]]; then
        echo ""
        log_debug "Error: Failed to create temporary directory"
        return $ERROR
    fi
    register_temp_dir "$temp_dir"
    update_progress "$label" 2 $progress
    progress=2

    # Download the file (2% -> 60%)
    local curl_args=(
        --http1.1
        --location
        --max-time 30
        --retry 3
        --retry-delay 1
        --output "$temp_dir/$tarfile"
    )

    if [[ "$VERBOSE" == true ]]; then
        curl_args+=(--verbose)
    else
        curl_args+=(--silent --show-error)
    fi

    # Execute curl and capture the process ID
    log_debug "Executing: $CURL ${curl_args[*]} \"$download_link\""
    "$CURL" "${curl_args[@]}" -- "$download_link" &
    local download_pid=$!

    # Simulate progress while downloading
    while kill -0 $download_pid 2>/dev/null; do
        if [ $progress -lt 60 ]; then
            progress=$((progress + 1))
            show_progress_bar "$label" $progress
        fi
        sleep 0.2
    done

    wait $download_pid
    local curl_exit_code=$?
    if [ $curl_exit_code -ne 0 ]; then
        echo "Error: Failed to download Vega CLI"
        log_debug "Error: Failed to download Vega CLI from $download_link (curl exit code: $curl_exit_code)"
        rm -rf "$temp_dir"
        return $ERROR
    fi

    # Verify the downloaded file exists and has content
    if [[ ! -f "$temp_dir/$tarfile" ]] || [[ ! -s "$temp_dir/$tarfile" ]]; then
        echo ""
        log_debug "Error: Downloaded file is missing or empty: $temp_dir/$tarfile"
        rm -rf "$temp_dir"
        return $ERROR
    fi

    # Ensure we're at 60%
    update_progress "$label" 60 $progress
    progress=60

    # Create install directory (60% -> 65%)
    if ! mkdir -p "$VVM_INSTALL_DIR"; then
        echo ""
        echo "Error: Failed to create install directory $VVM_INSTALL_DIR/"
        return $ERROR
    fi
    update_progress "$label" 65 $progress
    progress=65

    # Get tar contents first for debugging
    local tar_output
    tar_output=$("$TAR" tzf "$temp_dir/$tarfile" 2>&1)
    log_debug "Tar contents: $tar_output"

    # Check if vega already exists and log its version
    local existing_version
    if existing_version=$(get_installed_vega_version); then
        log_debug "Existing vega version before extraction: $existing_version"
    fi

    # Force overwrite by removing existing vega binary
    if [[ -f "$VVM_INSTALL_DIR/vega" ]]; then
        log_debug "Removing existing vega binary to ensure clean installation"
        rm -f "$VVM_INSTALL_DIR/vega" || {
            echo ""
            echo "Error: Failed to remove existing vega binary"
            rm -rf "$temp_dir"
            return $ERROR
        }
    fi

    # Extract the file (65% -> 90%)
    "$TAR" xzf "$temp_dir/$tarfile" -C "$VVM_INSTALL_DIR" &
    local tar_pid=$!

    # Simulate progress while extracting
    while kill -0 $tar_pid 2>/dev/null; do
        if [ $progress -lt 90 ]; then
            progress=$((progress + 1))
            show_progress_bar "$label" $progress
        fi
        sleep 0.1
    done

    wait $tar_pid
    local tar_exit_code=$?
    if [ $tar_exit_code -ne 0 ]; then
        echo ""
        echo "Error: Failed to untar $temp_dir/$tarfile to $VVM_INSTALL_DIR (exit code: $tar_exit_code)"
        rm -rf "$temp_dir"
        return $ERROR
    fi

    log_debug "Tar extraction completed with exit code: $tar_exit_code"
    log_debug "Tar output: $tar_output"
    log_debug "Contents of $VVM_INSTALL_DIR after extraction: $(ls -la "$VVM_INSTALL_DIR" 2>/dev/null)"

    update_progress "$label" 90 $progress
    progress=90

    # Rename kepler to vega if needed (90% -> 95%)

    if echo "$tar_output" | grep -q "kepler"; then
        log_debug "Renaming kepler to vega"
        if ! mv "$VVM_INSTALL_DIR/kepler" "$VVM_INSTALL_DIR/vega"; then
            echo ""
            echo "Error: Failed to move $VVM_INSTALL_DIR/kepler to $VVM_INSTALL_DIR/vega"
            rm -rf "$temp_dir"
            return $ERROR
        fi
    else
        log_debug "No kepler found in archive, expecting vega directly"
    fi
    update_progress "$label" 95 $progress
    progress=95

    # Set permissions (95% -> 98%)
    if ! chmod +x "$VVM_INSTALL_DIR/vega"; then
        echo ""
        echo "Error: Failed to set executable permissions on $VVM_INSTALL_DIR/vega"
        rm -rf "$temp_dir"
        return $ERROR
    fi
    update_progress "$label" 98 $progress
    progress=98

    # Cleanup (98% -> 100%)
    if ! rm -rf "$temp_dir"; then
        log_debug "Unable to remove $temp_dir"
    fi
    update_progress "$label" 100 $progress
    progress=100
    update_progress "$label" 100 $progress

    return $SUCCESS
}
#endregion

function determine_platform() {
    local platform
    local uname_out

    if ! UNAME=$(command -v -p uname); then
        echo "uname not found."
        return $ERROR
    fi
    uname_out=$($UNAME -s -m)
    case "${uname_out}" in
    "Linux x86_64") platform="linux-x86_64" ;;
    "Darwin arm64") platform="darwin-aarch64" ;;
    "Darwin x86_64") platform="darwin-x86_64" ;;
    *) platform="unknown" ;;
    esac

    echo "$platform"
}

#endregion

#endregion

#region Vega SDK command execution with logging
# Helper function to execute vega sdk commands with proper output handling
# - By default runs interactively (output goes directly to terminal)
# - Logs all stderr via log_debug
# - Returns the command's exit status
# - Use --silent flag to suppress all output (for data processing)
# - Use --capture flag to capture stdout while also displaying it
function run_vega_sdk_command() {
    local silent=false
    local capture=false
    local cmd_args=()

    # Check for flags
    while [[ $# -gt 0 ]]; do
        case "$1" in
        --silent)
            silent=true
            shift
            ;;
        --capture)
            capture=true
            shift
            ;;
        *)
            break
            ;;
        esac
    done

    cmd_args=("$@")

    # Add --verbose flag if not already present and not in silent mode
    local has_verbose=false
    for arg in "${cmd_args[@]}"; do
        if [[ "$arg" == "--verbose" ]]; then
            has_verbose=true
            break
        fi
    done

    # Only add --verbose if it's not already present AND we're not in silent mode
    if [[ "$has_verbose" == "false" && "$silent" == "false" ]]; then
        cmd_args+=("--verbose")
    fi

    local exit_code
    local captured_stdout
    local temp_stderr

    # Log the command being executed
    local cmd_string
    printf -v cmd_string '%q ' "$VVM_INSTALL_DIR/vega" "${cmd_args[@]}"
    log_debug "Executing vega sdk command: $cmd_string"

    # Create temporary file for stderr capture
    temp_stderr=$(mktemp)
    register_temp_file "$temp_stderr"

    if [[ "$silent" == "true" ]]; then
        # Silent mode: capture output but don't display anything
        captured_stdout=$("$VVM_INSTALL_DIR/vega" "${cmd_args[@]}" 2>"$temp_stderr")
        exit_code=$?
    elif [[ "$capture" == "true" ]]; then
        # Capture mode: capture output AND display it
        captured_stdout=$("$VVM_INSTALL_DIR/vega" "${cmd_args[@]}" 2>"$temp_stderr")
        exit_code=$?
        # Display captured output to terminal
        if [[ -n "$captured_stdout" ]]; then
            echo "$captured_stdout"
        fi
    else
        # Default interactive mode: run directly without capturing stdout
        # This allows real-time prompts, progress bars, and all output to flow naturally
        "$VVM_INSTALL_DIR/vega" "${cmd_args[@]}" 2>"$temp_stderr"
        exit_code=$?
        captured_stdout="" # No stdout capture for default interactive mode
    fi

    # Read and log any stderr output
    if [[ -f "$temp_stderr" ]] && [[ -s "$temp_stderr" ]]; then
        while IFS= read -r line; do
            log_debug "VEGA STDERR: $line"
        done <"$temp_stderr"
    fi

    # Cleanup
    rm -f "$temp_stderr"

    # Log the exit code and stdout for debugging
    log_debug "Vega sdk command exit code: $exit_code"
    if [[ -n "$captured_stdout" ]]; then
        log_debug "Vega sdk command stdout: $captured_stdout"
    fi

    # Store captured stdout in a global variable for functions that need the output
    VEGA_SDK_OUTPUT="$captured_stdout"

    return $exit_code
}

#endregion

#region Vega CLI functions

# Get the Vega CLI metadata from KPM.
# shellcheck disable=SC2329
function get_vvm_version_from_metadata() {
    local md=''

    if ! md=$(get_metadata); then
        log_debug "Unable to get metadata"
        return $ERROR
    fi

    if [[ -z $md ]]; then
        log_debug "No metadata returned"
        return $ERROR
        log_debug "Unable to get metadata"
        return $ERROR
    fi

    log_debug "Metadata: $md"

    # Extract latest version/checksum pair from a JSON array using jq
    local latest=''
    local status=0
    local error=''
    local tmpfile
    tmpfile=$(mktemp)
    latest=$(echo "$md" | $JQ -r '.versions | sort_by(.created_at) | reverse | .[0] | .version + " " + .sha_checksum' 2>"$tmpfile")
    status=$?

    error=$(cat "$tmpfile")
    rm "$tmpfile"

    if [[ $status -ne $SUCCESS ]]; then
        log_debug "$error"
        log_debug "$latest"
        echo ''
        return $ERROR
    else
        if [[ -z "$latest" ]]; then
            echo ''
            return $ERROR
        else
            echo "$latest"
            return $SUCCESS
        fi
    fi
}
# Get link to download Vega CLI.
function get_vvm_download_link() {
    local version=$1
    local response=''
    local url="${KPM_BASE_URL}/${KPM_REPO}/KeplerVersionManager"

    # Use curl's -G flag with --data-urlencode for safe parameter handling
    local curl_args=(
        -G # Use GET method with data
        --http1.1
        --location
        --max-time 30
        --retry 3
        --retry-delay 1
        --write-out "%{onerror}curl error: (%{exitcode}) %{errormsg}"
        --data-urlencode "platform=${PLATFORM}"
        --data-urlencode "version=${version}"
    )

    if [[ "$VERBOSE" == true ]]; then
        curl_args+=(--verbose)
    else
        curl_args+=(--silent --show-error)
    fi

    local temp_stderr temp_stdout
    temp_stderr=$(mktemp)
    temp_stdout=$(mktemp)

    # log the command line
    local curl_string
    printf -v curl_string '%q ' "$CURL" "${curl_args[@]}" "$url"
    log_debug "$curl_string"

    # Execute curl and capture both stdout and stderr
    "$CURL" "${curl_args[@]}" "$url" >"$temp_stdout" 2>"$temp_stderr"
    local curl_exit_code=$?

    # Read the response from stdout
    response=$(cat "$temp_stdout")

    # Process stderr output (verbose logs and error messages)
    if [[ -f "$temp_stderr" ]] && [[ -s "$temp_stderr" ]]; then
        while IFS= read -r line; do
            # Display to terminal and log all stderr output
            echo "$line" >&2
            log_debug "CURL ERROR: $line"
        done <"$temp_stderr"
    fi

    # Cleanup temp files
    rm -f "$temp_stderr" "$temp_stdout"

    # Check curl exit code
    if [[ $curl_exit_code -ne 0 ]]; then
        log_debug "Curl failed with exit code: $curl_exit_code"
        return $curl_exit_code
    fi

    # Process response
    if [[ -z "$response" ]]; then
        local error_msg="Failed to get download link from: $url"
        echo "$error_msg" >&2
        log_debug "$error_msg"
        log_debug "Curl args: ${curl_args[*]}"
        return $ERROR
    fi

    local s3=''
    if s3=$(parse_s3_link_from_json "$response"); then
        echo "$s3"
        return $SUCCESS
    else
        return $ERROR
    fi
}

function parse_s3_link_from_json() {
    local response=$1
    local s3=''
    local status=$SUCCESS

    local error=''
    # Parse JSON using jq
    local tmpfile
    tmpfile=$(mktemp)
    s3="$(echo "$response" | "$JQ" -r '.s3_link' 2>"$tmpfile")"
    status=$?
    error=$(cat "$tmpfile")
    rm "$tmpfile"

    if [[ $status -ne $SUCCESS ]]; then
        log_debug "$error"
        echo ''
        return $ERROR
    fi

    if [[ -z "$s3" ]] || [[ "$s3" == "null" ]] || [[ "$s3" == "None" ]]; then
        log_debug "Failed to get download_link from response: $s3"
        echo ''
        return $ERROR
    else
        echo "$s3"
        return $SUCCESS
    fi
}

# Get VVM version from "vega -v"
function get_installed_vega_version() {
    local version=''

    # Check if VVM_INSTALL_DIR is set and vega exists
    if [[ -z "$VVM_INSTALL_DIR" ]]; then
        log_debug "VVM_INSTALL_DIR not set"
        return $ERROR
    fi

    if [[ ! -x "$VVM_INSTALL_DIR/vega" ]]; then
        log_debug "vega command not found at $VVM_INSTALL_DIR/vega"
        return $ERROR
    fi

    if ! version=$("$VVM_INSTALL_DIR/vega" -v --json | "$JQ" -r '.vegaCLIVersion'); then
        log_debug "Error calling ${VVM_INSTALL_DIR}/vega -v: $version"
        return $ERROR
    fi

    if [[ -z "$version" ]]; then
        log_debug "No vega version found"
        return $ERROR
    fi

    echo "$version"
    return $SUCCESS
}

# Use vega sdk to list versions from remote
function get_latest_sdk_version_from_remote() {
    local latest

    if ! run_vega_sdk_command --silent sdk list-remote --json; then
        log_debug "Error getting remote versions"
        return $ERROR
    fi

    # Use the captured output from the global variable
    if [[ -z "$VEGA_SDK_OUTPUT" ]]; then
        log_debug "No remote versions found"
        return $ERROR
    fi

    latest=$(echo "$VEGA_SDK_OUTPUT" | "$JQ" -r '.versions[] | select(.isLatest == true) | .version')

    if [[ -z "$latest" ]]; then
        log_debug "No LATEST version found in remote versions"
        echo ''
        return $ERROR
    fi

    echo "$latest"
    return $SUCCESS
}

function get_installed_sdk_versions() {
    if ! run_vega_sdk_command --silent sdk list-installed; then
        log_debug "Error getting locally installed versions"
        return $ERROR
    fi

    # Return the captured output from the global variable
    echo "$VEGA_SDK_OUTPUT"
    return $SUCCESS
}

#endregion

#region KPM functions
function get_metadata() {
    if [[ "$PLATFORM" == "unknown" ]]; then
        echo "Error: Unsupported platform detected"
        return $ERROR
    fi

    local url="${KPM_BASE_URL}/${KPM_REPO}/metadata/KeplerVersionManager?platform=${PLATFORM}"
    local metadata=''

    log_debug "Metadata request: $url"

    if [[ -z "$CURL" ]]; then
        local error_msg="Error: curl not available for metadata request"
        echo "$error_msg" >&2
        log_debug "$error_msg"
        return $ERROR
    fi

    local temp_stderr temp_stdout
    temp_stderr=$(mktemp)
    temp_stdout=$(mktemp)
    register_temp_file "$temp_stderr"
    register_temp_file "$temp_stdout"

    # Configure curl arguments with error handling
    local curl_args=(
        --http1.1
        --location
        --max-time 30
        --retry 3
        --retry-delay 1
        --output "$temp_stdout"
        --write-out "%{onerror}curl error: (%{exitcode}) %{errormsg}"
    )

    if [[ "$VERBOSE" == true ]]; then
        curl_args+=(--verbose)
    else
        curl_args+=(--silent --show-error)
    fi

    # log the command line
    local curl_string
    printf -v curl_string '%q ' "$CURL" "${curl_args[@]}" "$url"
    log_debug "$curl_string"

    # Execute curl and capture stderr
    "$CURL" "${curl_args[@]}" "$url" 2>"$temp_stderr"
    local curl_exit_code=$?

    # Read the response from output file
    metadata=$(cat "$temp_stdout")

    # Process stderr output (verbose logs and error messages)
    if [[ -f "$temp_stderr" ]] && [[ -s "$temp_stderr" ]]; then
        while IFS= read -r line; do
            # This is our formatted error message - display to terminal and log it
            echo "$line" >&2
            log_debug "CURL ERROR: $line"
        done <"$temp_stderr"
    fi

    # Cleanup temp files
    rm -f "$temp_stderr" "$temp_stdout"

    # Check curl exit code
    if [[ $curl_exit_code -ne 0 ]]; then
        log_debug "Curl failed with exit code: $curl_exit_code"
        return $curl_exit_code
    fi

    # Process response
    if [[ -z "$metadata" ]]; then
        local error_msg="Failed to get metadata from: $url"
        echo "$error_msg" >&2
        log_debug "$error_msg"
        return $ERROR
    fi

    log_debug "Metadata: $metadata"
    echo "$metadata"
    return $SUCCESS
}
# endregion

#region Ordered functions
function _001_check_prereqs() {
    if [[ -z "$HOME_DIR" ]]; then
        printf "%s Warning: Could not determine home directory\n" "$YELLOW_WARNING"
        printf "Installation will proceed using temporary directory: %s\n" "${TMPDIR:-/tmp}/vega"
        printf "You may need to manually configure shell environment after installation\n\n"
        log_debug "HOME_DIR not available, using fallback directory"
    fi

    if [[ -n "$HOME_DIR" && "$HOME_DIR" == *" "* ]]; then
        echo "$HOME_DIR has spaces."
        echo "To ensure proper CLI functioning, please set HOME to a path without spaces"

        log_debug "Error: HOME_DIR contains spaces"
        return $ERROR
    fi

    if [[ -z "$CURL" ]]; then
        echo "Error: Curl not found"
        #shellcheck disable=SC2016
        echo 'Please install curl and ensure it is on the PATH'

        log_debug "Error: Curl not found"
        return $ERROR
    fi

    # snap curl considered harmful. If snap, then platform is Ubuntu.
    # https://askubuntu.com/questions/1387141/curl-23-failure-writing-output-to-destination
    if [[ "$CURL" == "/snap/bin/curl" ]]; then
        printf "%s Avoiding /snap/bin/curl. Install curl via apt:" "$BLACK_X"
        printf "sudo snap remove curl\n"
        printf "sudo apt install curl\n"
        return $ERROR
    fi

    if [[ -z "$JQ" ]]; then
      echo "jq is required. Please install jq and ensure it is on the PATH."
      return $ERROR
    fi

    if [[ -z "$TAR" ]]; then
        echo "Error: Tar not found"
        #shellcheck disable=SC2016
        echo 'Please install tar and ensure it is on the PATH'

        log_debug "Error: Tar not found"
        return $ERROR
    fi

    return $SUCCESS
}

function _002_check_running_script() {

    if [ "$(id -u)" == "0" ]; then
        if [ "$NONINTERACTIVE" == true ]; then
            printf "%s Running as root user in non-interactive mode.\n" "$YELLOW_WARNING"
            log_info "Script running as root user in non-interactive mode - continuing without warning"
        else
            log_fatal "This script must not be run as root"
            return $ERROR
        fi
    fi

    # shellcheck disable=SC2292
    if [ -z "${BASH_VERSION:-}" ]; then
        log_fatal "This script must be run with bash."
        return $ERROR

    fi

    # Check that scpt is not running under Rosetta
    if ! is_running_natively; then
        log_fatal <<END
Installer appears to be running under Rosetta on Mac arm64.
This will cause installer to fail.
Please ensure your bash is native arm64 (try /bin/bash)
or that your terminal is not opened using Rosetta.
END
        return $ERROR
    fi

    # Check if script is run in POSIX mode
    if [[ -n "${POSIXLY_CORRECT+1}" ]]; then
        log_fatal 'Bash must not run in POSIX mode. Please unset POSIXLY_CORRECT and try again.'
        return $ERROR
    fi
}

function _010_welcome_to_vvm() {
    printf "\n%s %sGreetings from Vega!%s %s\n\n" "$STARS" "$BOLD" "$UNBOLD" "$STARS"
    printf "This script downloads and installs the Vega CLI.\n\n"
}

function _020_metrics_notice() {
    printf "%s The Vega SDK and its packaged tools collect telemetry by default.\n" "$YELLOW_WARNING"
    printf "For details about the types of telemetry collected or instructions on how to opt out,\n"
    printf "visit https://developer.amazon.com/docs/vega/latest/telemetry.html.\n\n"
}

# Main installation with overall progress
function _030_download_and_install_vvm() {
    local temp_dir
    local tarfile="vega.tar.gz"
    local download_link=''

    if [[ "$PLATFORM" == "unknown" ]]; then
        echo "Error: Unsupported platform detected"
        return $ERROR
    fi

    printf "%s\n" "Getting latest Vega CLI version..."
    local vc version checksum
    if ! vc=$(get_vvm_version_from_metadata); then
        echo "Unable to get version for Vega CLI"
        return $ERROR
    fi
    read -r version checksum <<<"$vc"

    # todo: checksum if ssl utilities found.

    if [[ -z $version ]]; then
        echo "Error: Failed to get version info for Vega CLI"
        return $ERROR
    else
        # See if that version is already installed.
        local installed_version
        if installed_version=$(get_installed_vega_version); then
            log_debug "Currently installed version: $installed_version"
            if [[ "$installed_version" == "$version" ]]; then
                printf "%s Vega CLI version %s already installed\n\n" "$BLACK_CHECK" "$version"
                return $SUCCESS
            fi
        else
            log_debug "No existing vega installation found"
        fi

        printf "Installing Vega CLI %s...\n" "$version"
        if install_vega_cli "$version"; then
            printf "Vega CLI %s installed to %s\n" "$version" "$VVM_INSTALL_DIR"

            # Verify the installation by checking the version after extraction
            log_debug "Verifying installation..."
            log_debug "Vega binary path: $VVM_INSTALL_DIR/vega"
            log_debug "Vega binary exists: $(test -f "$VVM_INSTALL_DIR/vega" && echo "yes" || echo "no")"
            log_debug "Vega binary executable: $(test -x "$VVM_INSTALL_DIR/vega" && echo "yes" || echo "no")"
            log_debug "Vega binary file info: $(ls -la "$VVM_INSTALL_DIR/vega" 2>/dev/null || echo "not found")"

            log_debug "Vega expected version: $version"
            local installed_version
            if installed_version=$(get_installed_vega_version); then
                log_debug "Vega installed version: $installed_version"

                # Verify the installed version matches the expected version
                if [[ "$installed_version" != "$version" ]]; then
                    echo "Error: Version mismatch - expected $version but got $installed_version"
                    log_debug "Version mismatch after installation"
                    return $ERROR
                fi
            else
                echo "Problem with installation: did not get installed version"
                return $ERROR
            fi
        else
            echo "Error: Installation failed"
            return $ERROR
        fi
    fi
}

function find_KEPLER_SDK_PATH_in_rc_file() {
    # Use HOME_DIR which is already properly initialized in set_globals()
    if [[ -z "$HOME_DIR" ]]; then
        echo ''
        return $ERROR
    fi
    
    local rc_files=("$HOME_DIR/.bashrc" "$HOME_DIR/.zshrc" "$HOME_DIR/.bash_profile" "$HOME_DIR/.zprofile" "$HOME_DIR/.profile")
    local sdk_path=''

    # Check if KEPLER_SDK_PATH is defined in any rc file
    for rc_file in "${rc_files[@]}"; do
        if [[ -f "$rc_file" ]]; then
            # Look for KEPLER_SDK_PATH in the rc file, excluding commented-out, and capture the value.
            local matching_line
            if matching_line=$(grep -E "^[[:space:]]*[^#]*(export[[:space:]]+)?KEPLER_SDK_PATH=" "$rc_file" | tail -1); then
                sdk_path=$(echo "$matching_line" | cut -d'=' -f2- | tr -d "\"'")
                log_debug "Found KEPLER_SDK_PATH=$sdk_path in $rc_file"
                break
            fi
        fi
    done

    if [[ -z $sdk_path ]]; then
        echo ''
        return $ERROR
    else
        echo "$sdk_path"
        return $SUCCESS
    fi
}

function _035_setup_vvm() {
    printf "%s\n" "Setting up Vega CLI..."

    # Call vega sdk config setup - uses default interactive mode for real-time prompts and progress
    if run_vega_sdk_command sdk config setup; then
        printf "%s Vega CLI set up \n\n" "$BLACK_CHECK"
    else
        printf "%s Vega CLI not set up \n\n" "$BLACK_X"
        return $ERROR
    fi

    local sdk_link_guidance="To manually link SDKs, run: vega sdk link --path <sdk_path>"
    local sdk_path
    if sdk_path=$(find_KEPLER_SDK_PATH_in_rc_file); then
        printf "%s\n" "Symlinking existing SDKs at $sdk_path"
        if ! run_vega_sdk_command sdk link --non-interactive=true; then
            log_debug "%s Did not link existing SDKs\n\n" "$BLACK_X"
            printf "%s %s\n\n" "$BLACK_BULLET" "$sdk_link_guidance"
        fi
    else
        printf "%s SDK linking not available, skipping\n\n" "$BLACK_CHECK"
        printf "%s %s\n\n" "$BLACK_BULLET" "$sdk_link_guidance"
    fi
}

function _060_install_sdk() {
    local status

    # Skip SDK installation if requested
    if [[ "${SKIP_SDK_INSTALL:-false}" == "true" ]]; then
        log_debug "Skipping SDK installation (SKIP_SDK_INSTALL=true)"
        printf "%s Skipping SDK installation per SKIP_SDK_INSTALL flag\n\n" "$BLACK_BULLET"
        return $SUCCESS
    fi

    # Use specific version if provided, otherwise get latest
    local target_version
    if [[ -n "${VEGA_SDK_VERSION:-}" ]]; then
        target_version="$VEGA_SDK_VERSION"
        log_debug "Using specified SDK version: $target_version"
    else
        target_version=$(get_latest_sdk_version_from_remote)
        if [[ -z "$target_version" ]]; then
            log_debug "Failed to get version from ${KPM_BASE_URL}/${KPM_REPO}"
            printf "%s Unable to get latest Vega SDK version from registry\n" "$BLACK_X"
            printf "%s%s/%s%s\n" "$BOLD" "$KPM_BASE_URL" "$KPM_REPO" "$UNBOLD"
            return $ERROR
        fi
    fi

    local installed_versions
    installed_versions=$(get_installed_sdk_versions)

    if [[ $installed_versions == *"$target_version"* ]]; then
        printf "%s Vega SDK version %s is already installed.\n\n" "$BLACK_CHECK" "$target_version"
        return $SUCCESS
    fi

    # In NONINTERACTIVE mode, automatically install without prompting
    if ! is_interactive; then
        log_debug "NONINTERACTIVE mode: automatically installing SDK version $target_version"
        
        printf "Downloading Vega SDK %s...\n" "$target_version"
        
        if run_vega_sdk_command sdk install "$target_version"; then
            printf "Installed %s\n" "$BLACK_CHECK"
            log_debug "_060_install_sdk completed successfully"
            return $SUCCESS
        else
            printf "Not installed %s \n" "$BLACK_X"
            log_debug "_060_install_sdk failed"
            return $ERROR
        fi
    fi

    if input=$(read_input "Install Vega SDK version ${target_version}? [Y/n]" "y" "press Enter for yes"); then
        log_debug "user input: $input"
    else
        status=$?

        if [[ $status -eq $QUIT ]]; then
            return $QUIT
        else
            echo "Error reading input: $input"
            return $ERROR
        fi
    fi

    # Validate and normalize input
    local answer
    if ! answer=$(validate_yes_no_input "$input"); then
        echo "Invalid input. Please enter 'y' or 'n'."
        return $ERROR
    fi

    # Use default if empty
    if [[ -z "$answer" ]]; then
        answer="y"
    fi

    if [[ $answer == "y" ]]; then
        # Call vega sdk install and capture both output and return status
        if run_vega_sdk_command sdk install "$target_version"; then
            status=$SUCCESS
        else
            status=$?
        fi

        # Check return status and return appropriate value
        if [[ $status -eq 0 ]]; then
            printf "Installed %s \n" "$BLACK_CHECK"
            log_debug "_060_install_sdk completed successfully"
            return $SUCCESS
        else
            printf "Not installed %s \n" "$BLACK_X"
            log_debug "_060_install_sdk failed with status: $status"
            return $ERROR
        fi

    else
        printf "Not installed %s \n" "$BLACK_X"
        log_debug "_060_install_sdk skipped by user input"
        return $SUCCESS
    fi
}

function _065_list_installed() {

    local installed_versions
    if ! installed_versions=$(get_installed_sdk_versions); then
        echo "Error: Failed to list installed SDKs"
        return $ERROR
    fi

    printf "%s\n\n" "$installed_versions"
    return $SUCCESS
}

function _070_install_vscode_extension() {
    local vscode_path=""
    local extension_name="amazon-devices.kepler-studio"
    local legacy_extensions=("amazon.kepler-extension-perf" "amazon.kepler-extension")
    local deprecated_extensions=("amazon.kepler-ui-extension")
    local input
    local status
    local vscode_found=false

    local install_from_msg="You may install Vega Studio from VSCode Marketplace: https://marketplace.visualstudio.com/items?itemName=amazon-devices.kepler-studio"

    # Find VSCode executable first
    if _find_vscode_executable; then
        vscode_found=true
        log_debug "VSCode found at: $vscode_path"
    else
        log_debug "Failed to find VSCode executable"
        vscode_found=false
    fi

    local answer

    # In NONINTERACTIVE mode, skip user prompts entirely if VSCode not found
    if [[ $NONINTERACTIVE == true && $vscode_found == false ]]; then
        printf "%s Visual Studio Code not found. Unable to install Vega Studio extension.\n" "$BLACK_BULLET"
        printf "%s\n\n" "$install_from_msg"
        return $SUCCESS
    fi

    # Ask user if they want to install VSCode extension
    if [[ $NONINTERACTIVE == true ]]; then
        answer="no"
    else
        if input=$(read_input "Install Vega Studio into Visual Studio Code? [Y/n]" "y" "press Enter for yes"); then
            log_debug "user input: $input"
        else
            status=$?
            if [[ $status -eq $QUIT ]]; then
                return $QUIT
            else
                echo "Error reading input: $input"
                return $ERROR
            fi
        fi

        # Validate and normalize input
        local answer=''
        if ! answer=$(validate_yes_no_input "$input"); then
            echo "Invalid input. Please enter 'y' or 'n'."
            return $ERROR
        fi

        # Use default if empty
        if [[ -z "$answer" ]]; then
            answer="y"
        fi
    fi

    # Now check if VSCode is available after getting user input
    if [[ $vscode_found == false ]]; then
        # VSCode not found, show message and return success
        printf "%s Visual Studio Code not found. Unable to install Vega Studio extension.\n" "$BLACK_BULLET"
        printf "%s\n\n" "$install_from_msg"
        return $SUCCESS
    fi

    if [[ $answer == "y" ]]; then
        log_debug "Installing Vega Studio VSCode extension"
    else
        log_debug "Skipping Vega Studio installation "
        printf "%s %s\n\n" "$BLACK_BULLET" "$install_from_msg"
        return $SUCCESS
    fi

    printf "Installing Vega Studio VSCode extension...\n"

    # Uninstall any existing extensions
    _uninstall_existing_vscode_extensions

    # Try to install from marketplace
    if _install_vscode_extension_from_marketplace; then
        printf "%s Vega Studio VSCode extension installed from marketplace\n" "$BLACK_CHECK"
        return $SUCCESS
    else
        printf "%s Failed to install Vega Studio VSCode extension from VSCode marketplace\n" "$RED_X"
        return $ERROR
    fi
}

function _090_write_vega_env() {
    local vega_env_dir
    
    # Get vega env directory with validation
    if ! vega_env_dir=$(get_vega_env_dir); then
        echo "Error: Could not determine vega environment directory"
        return $ERROR
    fi
    
    if [[ -z "$vega_env_dir" ]]; then
        echo "Error: vega_env_dir is empty"
        return $ERROR
    fi

    if ! mkdir -p "$vega_env_dir"; then
        echo "Error: Failed to create $vega_env_dir"
        return $ERROR
    fi

    if ! touch "$vega_env_dir/env"; then
        echo "Error: Failed to create $vega_env_dir/env"
        return $ERROR
    fi

    if ! chmod 600 "$vega_env_dir/env"; then
        echo "Error: Failed to set permissions on $vega_env_dir/env"
        return $ERROR
    fi

    # Start with the base env file content
    cat >"$vega_env_dir/env" <<EOF
#!/bin/sh
# Add vega to the path
case ":\${PATH}:" in
    *:"$VVM_INSTALL_DIR":*)
        ;;
    *)
        export PATH="$VVM_INSTALL_DIR:\$PATH"
        ;;
esac
EOF

    # Get SDK path from vega -v --json and export KEPLER_SDK_PATH unconditionally
    local sdk_path
    if [[ -x "$VVM_INSTALL_DIR/vega" ]]; then
        sdk_path=$("$VVM_INSTALL_DIR/vega" -v --json 2>/dev/null | "$JQ" -r '.sdkPath' 2>/dev/null)

        if [[ -n "$sdk_path" && "$sdk_path" != "null" ]]; then
            log_debug "Adding KEPLER_SDK_PATH=$sdk_path to vega/env"
            cat >>"$vega_env_dir/env" <<EOF

# Legacy KEPLER_SDK_PATH for backward compatibility
# This variable is NOT dynamically updated
export KEPLER_SDK_PATH=$sdk_path
EOF
        else
            log_debug "Could not determine SDK path from vega -v --json"
        fi
    fi

    # Create kepler symlink for backward compatibility
    if [[ -f "$VVM_INSTALL_DIR/vega" ]] && [[ ! -e "$VVM_INSTALL_DIR/kepler" ]]; then
        if ln -s "$VVM_INSTALL_DIR/vega" "$VVM_INSTALL_DIR/kepler"; then
            printf "%s Symlinked %svega%s to %skepler%s for backward compatibility.\n" "$YELLOW_WARNING"  "$BOLD" "$UNBOLD" "$BOLD" "$UNBOLD"
            printf "Use %svega%s directly for all future invocations.\n" "$BOLD" "$UNBOLD"
            log_debug "Symlinked vega to kepler for backward compatibility."
        else
            log_debug "Failed to create kepler symlink (non-fatal)"
        fi
    fi

    # Create vvman symlink
    if [[ -f "$VVM_INSTALL_DIR/vega" ]] && [[ ! -e "$VVM_INSTALL_DIR/vvman" ]]; then
        if ln -s "$VVM_INSTALL_DIR/vega" "$VVM_INSTALL_DIR/vvman"; then
            log_debug "Symlinked vega to vvman."
        else
            log_debug "Failed to create vvman symlink (non-fatal)"
        fi
    fi
}

# The .rc file sources the env file written above.
function _100_modify_rc_files() {
    # Skip if HOME_DIR is not available
    if [[ -z "$HOME_DIR" ]]; then
        echo "HOME directory not available - skipping shell configuration"
        echo "To use Vega CLI, add this to your shell configuration:"
        echo "export PATH=\"$VVM_INSTALL_DIR:\$PATH\""
        return $SUCCESS
    fi

    local vega_env_dir
    
    # Get vega env directory with validation
    if ! vega_env_dir=$(get_vega_env_dir); then
        echo "Error: Could not determine vega environment directory"
        return $ERROR
    fi
    
    if [[ -z "$vega_env_dir" ]]; then
        echo "Error: vega_env_dir is empty"
        return $ERROR
    fi

    source_line="source \"$vega_env_dir/env\""
    rc_line=$(printf "\n#Vega CLI\n%s" "$source_line")
    local failed_to_modify=0

    local configs_modified=()
    local rc_files=("$HOME_DIR/.bashrc" "$HOME_DIR/.zshrc" "$HOME_DIR/.bash_profile" "$HOME_DIR/.zprofile" "$HOME_DIR/.profile")
    for rc_file in "${rc_files[@]}"; do
        if [[ -f "$rc_file" ]]; then
            if ! grep -q "$source_line" "$rc_file"; then
                log_debug "Modifying $rc_file"
                if echo "$rc_line" >>"$rc_file"; then
                    configs_modified+=("$rc_file")
                else
                    failed_to_modify=$((failed_to_modify + 1))
                fi
            fi
        else
            log_debug "$rc_file not found, skipping"
            failed_to_modify=$((failed_to_modify + 1))
        fi
    done

    if [[ $failed_to_modify -eq ${#rc_files[@]} ]]; then
        echo "To use Vega CLI command 'vega',"
        echo "add the following to your shell configuration:"
        echo "$source_line"
        echo "Then restart your shell for change to take effect."
    elif [[ ${#configs_modified[@]} -gt 0 ]]; then
        echo "Modified shell .rc files: ${configs_modified[*]}"
    fi
}

function _110_goodbye() {
    printf "\n\n%s You're all set!\n\n" "$STARS"

    printf "%s Show installed Vega SDKs: vega sdk list-installed\n" "$BLACK_BULLET"
    printf "%s List available SDK versions to install: vega sdk list-remote\n" "$BLACK_BULLET"
    printf "%s Build your first app with the CLI or in Vega Studio: https://developer.amazon.com/docs/vega/latest/hello-world.html\n" "$BLACK_BULLET"
}
#endregion

#region the main show

function execute_function() {
    local func_name="$1"

    if [[ -z "$func_name" ]]; then
        echo "Error: No function name provided to _execute_function"
        return $ERROR
    fi

    if declare -f "$func_name" >/dev/null; then
        if "$func_name"; then
            log_debug "$func_name completed successfully"
            return $SUCCESS
        else
            local status=$?
            if [ $status -eq $QUIT ]; then
                log_debug 'Exiting'
                printf "Exiting...\n"
                return $SUCCESS
            elif [ $status -eq $WARNING ]; then
                log_debug "$func_name: nonfatal error"
                return $SUCCESS
            elif [ $status -ne 0 ]; then
                log_debug "✗ $func_name failed"
                return $ERROR
            fi
        fi
    else
        echo "Error: Function $func_name not found"
        return $ERROR
    fi

    echo "" # Add spacing between function executions
}

function main() {
    # Set up traps with signal names passed to the handler
    # Exit after cleanup for signals (128 + signal number convention)
    trap 'cleanup INT; exit 130' INT   # SIGINT = 2, so 128 + 2 = 130
    trap 'cleanup TERM; exit 143' TERM # SIGTERM = 15, so 128 + 15 = 143
    trap 'cleanup EXIT' EXIT

    set_globals
    open_log
    log_globals
    funcs=()
    while IFS= read -r line; do
        funcs+=("$line")
    done < <(compgen -A function | grep -e '^_[0-9][0-9][0-9]' | sort)

    for func in "${funcs[@]}"; do
        if ! execute_function "$func"; then
            echo "Exiting..."
            return $ERROR
        fi
    done
}
#endregion

if ! is_sourced; then
    set_strict_mode
    main "$@"
    exit $?
fi
