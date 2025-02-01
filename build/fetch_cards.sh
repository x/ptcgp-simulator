#!/bin/bash

# ====================================================
# Script to Fetch TCGDex Card Information and Populate JSON Files
# ====================================================
#
# This script retrieves card information from specified sets
# using the TCGDex API and saves the selected data to separate
# JSON files in the `js/sets/` directory.
#
# Requirements:
# - curl
# - jq
#
# Usage:
#   ./fetch_cards.sh
#
# ====================================================

# --------------------
# Configuration Variables
# --------------------

# API hostname (modifiable)
API_HOST="https://api.tcgdex.net/v2/en"

# List of set codes to process (add/remove sets here)
# To add new sets:
# 1. Update this list with the new set code(s)
# 2. Add the set code to js/app.js in the `setCodes` array
# 3. Run this script
SETS=("A1" "A1a" "P-A")

# Output directory path
OUTPUT_DIR="sets"

# Number of cards to fetch per set (useful for testing; set to empty for all)
CARD_LIMIT=""

# --------------------
# Function Definitions
# --------------------

# Function to fetch and process card data for a given set
fetch_set_cards() {
    local set_code="$1"
    local output_file="$OUTPUT_DIR/$set_code.json"

    # Skip if the file already exists
    if [[ -f "$output_file" ]]; then
        echo "Skipping set: $set_code (already exists)"
        return 0
    fi

    echo "Processing set: $set_code"

    # Construct the URL for the set
    local set_url="$API_HOST/sets/$set_code"

    # Fetch set data
    echo "Fetching set data from $set_url..."
    local set_data
    set_data=$(curl -s "$set_url")
    if [[ $? -ne 0 || -z "$set_data" ]]; then
        echo "Error: Failed to fetch data for set $set_code"
        return 1
    fi

    # Extract card IDs using jq
    local card_ids
    card_ids=$(echo "$set_data" | jq -r '.cards[].id')
    if [[ -z "$card_ids" ]]; then
        echo "Warning: No cards found for set $set_code"
        return 0
    fi

    # Apply card limit if specified
    if [[ -n "$CARD_LIMIT" ]]; then
        card_ids=$(echo "$card_ids" | head -n "$CARD_LIMIT")
    fi

    # Ensure the output directory exists
    mkdir -p "$OUTPUT_DIR"

    # Initialize/Empty the output file
    echo "[" > "$output_file"

    local first_entry=true
    
    # Iterate over each card ID and fetch card details
    for card_id in $card_ids; do
        echo "  Fetching card data for ID: $card_id"

        # Construct the URL for the card
        local card_url="$API_HOST/cards/$card_id"

        # Fetch card data
        local card_data
        card_data=$(curl -s "$card_url")
        if [[ $? -ne 0 || -z "$card_data" ]]; then
            echo "  Error: Failed to fetch data for card ID $card_id"
            continue
        fi

        # Extract required fields using jq
        local extracted
        extracted=$(echo "$card_data" | jq '{category, id, image, localId, name, hp, types, stage, attacks, retreat, evolveFrom}')

        # Append the extracted data to the output file
        if [ "$first_entry" = true ]; then
            first_entry=false
        else
            echo "," >> "$output_file"
        fi
        echo "$extracted" >> "$output_file"
    done

    # Close the JSON array in the output file
    echo "]" >> "$output_file"
    echo "Set $set_code processed. Data saved to $output_file"
}

# --------------------
# Main Script Execution
# --------------------

# Iterate over each set and fetch card data
for set_code in "${SETS[@]}"; do
    fetch_set_cards "$set_code"
done

echo "All sets processed. Data saved in $OUTPUT_DIR"