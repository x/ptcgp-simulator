
/**
 * The main Alpine component for the simulator form.
 */
function pokemonSimulator () {
  return {
    deckSelectInstance: null,
    targetSelectInstance: null,

    initChoices () {
      // 1) Deck select
      this.deckSelectInstance = new Choices(this.$refs.deckSelect, {
        removeItemButton: true,
        placeholderValue: 'Pick your deck cards...',
        shouldSort: false
      })

      // Populate it
      const deckLabels = this.getCardLabelOptions()
      const choiceObjects = deckLabels.map(lbl => ({
        value: lbl['label'],
        label: lbl['label']
      }))
      this.deckSelectInstance.setChoices(choiceObjects, 'value', 'label', true)

      // Add event listeners to handle picking or removing items
      const deckEl = this.deckSelectInstance.passedElement.element
      deckEl.addEventListener('addItem', event => {
        const newlyAdded = event.detail.value // e.g. "Bulbasaur 1x"
        this.handleAddDeckItem(newlyAdded)
      })

      deckEl.addEventListener('removeItem', event => {
        const removed = event.detail.value // e.g. "(A1-001) Bulbasaur x1"
        this.handleRemoveDeckItem(removed)
      })

      // 2) Target select
      this.targetSelectInstance = new Choices(this.$refs.targetCards, {
        removeItemButton: true,
        placeholderValue: 'Pick your target cards...'
      })
    },

    handleAddDeckItem (newlyAddedLabel) {
      // E.g. newlyAddedLabel = "(A1-001) Bulbasaur x1"
      const { id, baseName, count } = this.parseLabel(newlyAddedLabel)

      // Check if the otherVariant is currently selected
      const selectedValues = this.deckSelectInstance
        .getValue(true)
        .map(x => (x.value ? x.value : x))
    
      // Iterate over the selected values and remove it if it has the same baseName
      for (let selectedValue of selectedValues) {
          const { id: selectedId, baseName: selectedBaseName, count: selectedCount } = this.parseLabel(selectedValue)
          if (selectedBaseName === baseName && (selectedId !== id || selectedCount !== count)) {
            // Remove it
            this.deckSelectInstance.removeActiveItemsByValue(selectedValue)
          }
      }
    
      // 2) Update target choices
      this.updateTargetChoices()
    },

    handleRemoveDeckItem (removedLabel) {
      // If we remove "Bulbasaur x1" but still have "Bulbasaur x2" in the deck, no problem.
      // If we remove "Bulbasaur x1" and there's no "Bulbasaur x2" left,
      // we might need to remove "Bulbasaur" from the target (if it's no longer in deck).
      this.updateTargetChoices()
    },

    updateTargetChoices () {
      // 1) Grab the *current* selected deck items
      const selectedDeckItems = this.deckSelectInstance
        .getValue(true)
        .map(x => {
          const label = x.value ? x.value : x // handle the object or string
          const { id, baseName } = this.parseLabel(label)
          return this.toLabel(id, baseName, null) // e.g. "(A1-001) Bulbasaur"
        })

      // 2) Unique base names from the deck
      const uniqueBaseNames = Array.from(new Set(selectedDeckItems))

      // 3) Let's keep track of what the user *currently* has selected in the target
      const oldTargetSelections = this.targetSelectInstance
        .getValue(true)
        .map(x => (x.value ? x.value : x))

      // 4) Clear out the *entire list* of target choices
      this.targetSelectInstance.removeActiveItems()

      // 5) Build new target choices based on the current deck
      const newTargetChoices = uniqueBaseNames.map(bn => ({
        value: bn,
        label: bn
      }))
      this.targetSelectInstance.setChoices(
        newTargetChoices,
        'value',
        'label',
        true
      )

      // 6) Reselect items that were *previously* selected if they still exist
      //    in the new set of uniqueBaseNames
      const stillValidSelections = oldTargetSelections.filter(bn =>
        uniqueBaseNames.includes(bn)
      )

      // For each still-valid selection, tell Choices to select it again
      stillValidSelections.forEach(bn => {
        this.targetSelectInstance.setChoiceByValue(bn)
      })

      // If something was previously selected but is no longer valid, it simply
      // won't be reselected -> effectively it's removed from the user's selection.
    },


    /**
     * A small helper that returns an array of label options like:
     *   [ {"name": '(A1-001) Bulbasaur x1', ...} {"name": '(A1-001) Bulbasaur x2', ...}, ... ]
     */
    getCardLabelOptions () {
      const labels = []
      for (let c of cards) {
        // Each card gets "Name x1" and "Name x2" versions
        labels.push({
            'label': this.toLabel(c.id, c.name, 1),
        })
        labels.push({
            'label': this.toLabel(c.id, c.name, 2),
        })
      }
      return labels
    },

    parseLabel (labelStr) {
      // labelStr e.g. "(A1-001) Bulbasaur 1x" => parse "(A1-001) Bulbasaur" and 1
      const cardName = labelStr.slice(0, -3)

      // The id is always at the start surrounded by parentheses
      const id = labelStr.match(/\(([^)]+)\)/)[1]

      // The base name is the card name without the id
      const baseName = cardName.slice(id.length + 3)

      // The count is the last character of the string
      const count = parseInt(labelStr.slice(-1))

      return { id, baseName, count }
    },

    toLabel (id, baseName, count) {
      if (count === null) {
        return `(${id}) ${baseName}`
      }
      return `(${id}) ${baseName} x${count}`
    },

    /** Fisher-Yates shuffle */
    shuffle(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
    }

    /**
     * This is called when the user presses "Run Simulation"
     */
    runSimulation () {
      // 1) Get the user’s chosen deck from deckSelect
      const chosenDeckLabels = this.deckSelectInstance
        .getValue(true)
        .map(item => item.value || item)

      // Build a literal deck array (e.g. ["Ponyta","Ponyta","Vulpix",...])
      const deckArray = []
      chosenDeckLabels.forEach(lbl => {
        id, baseName, count = this.parseLabel(lbl)
        for (let i = 0; i < count; i++) {
          deckArray.push(baseName)
        }
      })

      // 2) Gather the user’s chosen targets from targetSelect
      const chosenTargets = this.targetSelectInstance
        .getValue(true)
        .map(item => item.value || item) // e.g. ["Ninetails", "Blaine"]

      // 3) We'll run N simulations, track success stats
      const numSimulations = 1000
      let successCount = 0
      let totalTurnsToSuccess = 0

      for (let i = 0; i < numSims; i++) {
        const simResult = this.singleSimulation(deckArray, chosenTargets)
        if (simResult.success) {
          successCount++
          totalTurnsToSuccess += simResult.turns
        }
      }

      // 4) Output
      const successRate = (successCount / numSims) * 100
      const avgTurns =
        successCount > 0
          ? (totalTurnsToSuccess / successCount).toFixed(2)
          : '--'
      console.log(`Out of ${numSims} simulations:`)
      console.log(`Success rate: ${successRate.toFixed(1)}%`)
      console.log(`Average turns to meet target: ${avgTurns}`)
    },

    // -------------- Core TCG logic for a SINGLE simulation --------------
    singleSimulation (deckArray, targetNames) {
      // We'll model a 20-card scenario or just whatever deck length we have.
      // 1) Clone the deck & shuffle
      const deck = [...deckArray]
      shuffleArray(deck)

      // 2) Mulligan until we have at least 1 Basic in opening hand of 5
      let hand = []
      const maxMulligans = 10
      let mulliganCount = 0
      while (true) {
        // If we run out of tries or the deck is too small, break
        if (mulliganCount >= maxMulligans || deck.length < 5) {
          // fail from the start
          return { success: false, turns: 0 }
        }

        // draw 5
        hand = deck.splice(0, 5)
        if (hand.some(card => isBasic(card))) {
          // we have at least 1 Basic
          break
        } else {
          // re-mulligan: put those 5 back, reshuffle, draw again
          deck.push(...hand)
          shuffleArray(deck)
          mulliganCount++
        }
      }

      // 3) We'll track what's "in play" as an array of objects:
      //    { name: "Vulpix", turnPlayed: 1, stage: "Basic" }
      //    so we know if we can evolve next turn, etc.
      let inPlay = []

      // 4) Now we simulate up to N turns
      const maxTurns = 12
      for (let turn = 1; turn <= maxTurns; turn++) {
        // --- Draw 1 card if available ---
        if (deck.length > 0) {
          hand.push(deck.shift())
        }

        // --- Use all Poké Balls in hand (before Professor Oak) ---
        //     We'll assume we *only* use them if we still need a Basic
        //     for some evolution line. We'll do a simple approach here:
        let keepSearching = true
        while (keepSearching) {
          const pokeballIndex = hand.findIndex(card => isPokeball(card))
          if (pokeballIndex === -1) {
            keepSearching = false
            break
          }
          // remove from hand
          hand.splice(pokeballIndex, 1)

          // "Search the deck for a Basic" => if any left
          const basicIndex = deck.findIndex(c => isBasic(c))
          if (basicIndex !== -1) {
            // fetch it into hand
            const foundBasic = deck.splice(basicIndex, 1)[0]
            hand.push(foundBasic)
          }
        }

        // --- Use all Professor Oaks in hand (draw 2) ---
        //     (We do them *after* using PokéBalls)
        let oakIndex = hand.findIndex(card => isProfessorOak(card))
        while (oakIndex !== -1) {
          // remove from hand
          hand.splice(oakIndex, 1)
          // draw 2
          for (let i = 0; i < 2; i++) {
            if (deck.length > 0) {
              hand.push(deck.shift())
            }
          }
          // find next oak
          oakIndex = hand.findIndex(card => isProfessorOak(card))
        }

        // --- If we have no Basic in play, put one down (the first we find) ---
        if (!inPlay.some(p => p.stage === 'Basic')) {
          const basicIndex = hand.findIndex(c => isBasic(c))
          if (basicIndex !== -1) {
            const basicName = hand.splice(basicIndex, 1)[0]
            inPlay.push({ name: basicName, stage: 'Basic', turnPlayed: turn })
          }
        }

        // --- Evolve if possible: Stage1 from its Basic that's been in play >= 1 turn
        //     We'll do a simple pass for all Stage1s in hand, see if we can evolve:
        for (let i = 0; i < hand.length; i++) {
          const cardName = hand[i]
          if (isStage1(cardName)) {
            const preEvo = evolvesFrom(cardName) // e.g. "Vulpix" => "Ninetails"
            // Check if we have the preEvo in play for at least 1 turn
            const targetInPlay = inPlay.find(
              p =>
                p.name === preEvo && p.stage === 'Basic' && p.turnPlayed < turn
            )
            if (targetInPlay) {
              // We can evolve
              // remove the stage1 from hand
              hand.splice(i, 1)
              i--
              // Remove the Basic from inPlay
              inPlay = inPlay.filter(p => p !== targetInPlay)
              // Add the Stage1 to inPlay
              inPlay.push({ name: cardName, stage: 'Stage1', turnPlayed: turn })
            }
          }
        }

        // --- Check if we have met all target conditions now ---
        if (this.checkTargetsMet(targetNames, hand, inPlay)) {
          return { success: true, turns: turn }
        }
      }

      // If we get here, we never met the target condition
      return { success: false, turns: maxTurns }
    },

    // -------------- Check if user’s target conditions are met --------------
    checkTargetsMet (targetNames, hand, inPlay) {
      // We interpret Pokemon targets as "must be in play"
      // and Trainer targets as "must be in hand."
      for (let tName of targetNames) {
        if (!CARD_INFO[tName]) {
          // If we have no info, just skip or treat as "not met."
          return false
        }
        const info = CARD_INFO[tName]
        if (info.type === 'pokemon') {
          // Must be in inPlay
          const found = inPlay.some(p => p.name === tName)
          if (!found) return false
        } else if (info.type === 'trainer') {
          // Must be in hand
          if (!hand.includes(tName)) return false
        } else {
          // Unrecognized type => fail
          return false
        }
      }
      // if we never returned false, all targets are satisfied
      return true
    }
  }
}

function shuffleArray (arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}
