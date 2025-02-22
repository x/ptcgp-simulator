/**
 * The main Alpine component for the simulator form.
 *
 * TODO:
 *  - Add a switch for "play pokeballs before research" or vice versa
 *  - Add support for "chatol" and "meowth" cards
 *  - Error when the deck is missing the pre-evolutions necessary
 *  - Error when more than 20 cards (maybe we should do form validation)
 *  - Allow choosing number of games to simulate
 *  - Support 1x of two cards with the same name
 *  - Add support for the psyhic item.
 *  - Add support for caterpie.
 */

/* Fetch all sets */
async function fetchAllSets () {
  /* To add new sets:
    1. Update this array.
    2. Update the SETS array in build/fetch_sets.sh.
    3. Run fetch_sets.sh
  */
  const setCodes = ['A1', 'A1a', 'P-A', 'A2']
  const allCards = []

  for (const setCode of setCodes) {
    try {
      const response = await fetch(`sets/${setCode}.json`)
      if (!response.ok) {
        console.error(`Failed to fetch ${setCode}: ${response.status}`)
        continue
      }
      const cards = await response.json()
      allCards.push(...cards)
    } catch (error) {
      console.error(`Error fetching set ${setCode}:`, error)
    }
  }

  return allCards
}

function pokemonSimulator () {
  return {
    targetGroups: [], // each element: { id, choicesInstance }
    nextTargetGroupId: 1, // used for unique IDs
    deckSelectInstance: null,
    allCards: null,
    allCardsMap: null,
    isSyncing: false, // guard against removing items during sync

    /**
     * Append an info message to the log output area.
     */
    logInfo (message) {
      // 1) Grab the log container via x-ref
      const container = this.$refs.logContainer

      // 2) Create a paragraph element
      const p = document.createElement('p')
      p.classList.add('info') // so you can style differently if you like
      p.textContent = message

      // 3) Append to container
      container.appendChild(p)
    },

    /**
     * Append an error message to the log output area.
     */
    logError (message) {
      // 1) Grab the log container
      const container = this.$refs.logContainer

      // 2) Create a paragraph element
      const p = document.createElement('p')
      p.classList.add('error')
      p.textContent = message

      // 3) Append to container
      container.appendChild(p)
    },

    /**
     * Clear the log output area.
     */
    clearLog () {
      this.$refs.logFieldset.classList.remove('hidden')
      this.$refs.logContainer.innerHTML = ''
    },

    /* Load all cards */
    async loadCards () {
      if (!this.allCards) {
        this.allCards = await fetchAllSets()
      }
    },

    /* Initialize the deck and target choices */
    async initChoices () {
      await this.loadCards()

      // 1) Deck select
      this.deckSelectInstance = new Choices(this.$refs.deckSelect, {
        removeItemButton: true,
        placeholderValue: 'Pick your deck cards...',
        shouldSort: false,
        searchResultLimit: 10
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

      // 2) Initialize at least one target group by default
      this.addTargetGroup()
    },

    /**
     * Dynamically create a new target group & init a separate Choices instance.
     */
    addTargetGroup () {
      console.log('Adding a new target group...')
      console.log('Current target groups:', this.targetGroups)
      const newId = this.nextTargetGroupId++
      // The 'savedSelections' array will track the user's currently selected items
      this.targetGroups.push({
        id: newId,
        choicesInstance: null,
        savedSelections: []
      })

      // Wait for Alpine to finish rendering
      this.$nextTick(() => {
        const selectEl = document.getElementById('targetSelect' + newId)
        const instance = new Choices(selectEl, {
          removeItemButton: true,
          placeholderValue: 'Pick your target cards...'
        })

        // Save the instance
        const groupObj = this.targetGroups.find(g => g.id === newId)
        if (!groupObj) return
        groupObj.choicesInstance = instance

        // --- NEW: set up event listeners to track selections
        const choicesEl = instance.passedElement.element
        choicesEl.addEventListener('addItem', evt => {
          if (this.isSyncing) return // ignore forced UI updates
          const val = evt.detail.value
          if (!groupObj.savedSelections.includes(val)) {
            groupObj.savedSelections.push(val)
          }
        })

        choicesEl.addEventListener('removeItem', evt => {
          console.log(
            'removeItem event:',
            evt.detail,
            'isSyncing:',
            this.isSyncing
          )
          if (this.isSyncing) return // ignore forced UI updates
          const val = evt.detail.value
          groupObj.savedSelections = groupObj.savedSelections.filter(
            x => x !== val
          )
        })

        // Finally, populate the new group's choices
        this.updateTargetChoices()
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
        const {
          id: selectedId,
          baseName: selectedBaseName,
          count: selectedCount
        } = this.parseLabel(selectedValue)
        if (
          selectedBaseName === baseName &&
          (selectedId !== id || selectedCount !== count)
        ) {
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

    /**
     * Update all target-groups' available choices based on current deck contents.
     */
    updateTargetChoices () {
      this.isSyncing = true // turn on guard

      // 1) Derive the valid deck-based labels from the deck...
      const selectedDeckItems = this.deckSelectInstance
        .getValue(true)
        .map(x => {
          const label = x.value ? x.value : x
          const { id, baseName } = this.parseLabel(label)
          return this.toLabel(id, baseName, null)
        })
      const uniqueBaseNames = Array.from(new Set(selectedDeckItems))

      // 2) For each target group:
      this.targetGroups.forEach(group => {
        const inst = group.choicesInstance
        if (!inst) return

        // (A) Clear existing selections from the UI
        inst.removeActiveItems()
        inst.clearChoices()

        // (B) Build new deck-based choices
        const newChoices = uniqueBaseNames.map(bn => ({
          value: bn,
          label: bn
        }))
        // Replace old choices with the new set
        inst.setChoices(newChoices, 'value', 'label', true)

        // (C) Re-select items from group.savedSelections that are still valid
        const stillValid = group.savedSelections.filter(bn =>
          uniqueBaseNames.includes(bn)
        )
        stillValid.forEach(bn => {
          inst.setChoiceByValue(bn)
        })

        // (D) Update group.savedSelections to match only the still-valid items
        group.savedSelections = stillValid
      })
      this.isSyncing = false // turn off guard
    },

    /**
     * A small helper that returns an array of label options like:
     *   [ {"name": '(A1-001) Bulbasaur x1', ...} {"name": '(A1-001) Bulbasaur x2', ...}, ... ]
     */
    getCardLabelOptions () {
      const labels = []
      for (let c of this.allCards) {
        if (c.name == 'Placeholder') {
          continue
        }
        // Each card gets "Name x1" and "Name x2" versions
        labels.push({
          label: this.toLabel(c.id, c.name, 1)
        })
        labels.push({
          label: this.toLabel(c.id, c.name, 2)
        })
      }
      return labels
    },

    parseLabel (labelStr) {
      let cardName, count
      // if it ends with 1 or 2, it contains a count
      if (labelStr.endsWith('x1') || labelStr.endsWith('x2')) {
        // labelStr e.g. "(A1-001) Bulbasaur 2x" => parse "(A1-001) Bulbasaur" and 2
        cardName = labelStr.slice(0, -3)
        count = parseInt(labelStr.slice(-1))
      } else {
        // labelStr e.g. "(A1-001) Bulbasaur" => parse "(A1-001) Bulbasaur" and 1
        cardName = labelStr
        count = 1
      }

      // The id is always at the start surrounded by parentheses
      const id = labelStr.match(/\(([^)]+)\)/)[1]

      // The base name is the card name without the id
      const baseName = cardName.slice(id.length + 3)

      return { id, baseName, count }
    },

    toLabel (id, baseName, count) {
      if (count === null) {
        return `(${id}) ${baseName}`
      }
      return `(${id}) ${baseName} x${count}`
    },

    /** Fisher-Yates shuffle */
    shuffle (array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[array[i], array[j]] = [array[j], array[i]]
      }
    },

    getCardMap () {
      if (!this.allCardsMap) {
        // Build it once
        this.allCardsMap = {}
        for (let c of this.allCards || []) {
          // your real data might store c.name as a string or c.name.en
          // adapt as needed
          const cardName = c.name
          this.allCardsMap[cardName] = c
        }
      }
      return this.allCardsMap
    },

    /**
     * Identify if a card is a Basic Pokemon
     */
    isBasicPokemon (cardName) {
      const c = this.getCardMap()[cardName]
      if (!c) return false
      return c.category === 'Pokemon' && c.stage === 'Basic'
    },

    /**
     * Identify if a card is a Pokemon
     */
    isPokemon (cardName) {
      const cardMap = this.getCardMap()
      const c = cardMap[cardName]
      return c && c.category === 'Pokemon'
    },

    /**
     * Identify if a card is a Pokemon
     */
    isTrainer (cardName) {
      const cardMap = this.getCardMap()
      const c = cardMap[cardName]
      return c && c.category === 'Trainer'
    },

    /**
     * Identify if a card is a Pokemon
     */
    isPokemon (cardName) {
      const cardMap = this.getCardMap()
      const c = cardMap[cardName]
      return c && c.category === 'Pokemon'
    },
    /**
     * Identify the stage of a Pokemon
     */
    getStage (cardName) {
      const c = this.getCardMap()[cardName]
      return c?.stage || null // "Basic","Stage1","Stage2", or null
    },

    /**
     * Evolve a Pokemon
     */
    getEvolveFrom (cardName) {
      const c = this.getCardMap()[cardName]
      return c?.evolveFrom || null
    },

    /**
     * Use all Pokeballs in hand.
     * Each time we find a Pokeball, remove it from hand,
     * then search the deck for any Basic. If found, put it in hand.
     */
    useAllPokeballs (hand, deck) {
      let idx = hand.findIndex(cn => cn === 'Pokeball')
      while (idx !== -1) {
        // remove from hand
        hand.splice(idx, 1)

        // find a Basic in deck
        const deckIdx = deck.findIndex(cn => this.isBasicPokemon(cn))
        if (deckIdx !== -1) {
          const basicName = deck.splice(deckIdx, 1)[0]
          hand.push(basicName)
        }

        idx = hand.findIndex(cn => cn === 'Pokeball')
      }
    },

    /**
     * Use exactly 1 Professor's Research if we find it in hand.
     * (Assumes the name is "Professor's Research".)
     * Then draw 2 from deck.
     */
    useOneProfessorResearch (hand, deck) {
      const idx = hand.indexOf("Professor's Research")
      if (idx !== -1) {
        // remove it
        hand.splice(idx, 1)
        // draw 2
        for (let i = 0; i < 2; i++) {
          if (deck.length > 0) {
            hand.push(deck.shift())
          }
        }
      }
    },

    /**
     * Attempt to evolve Stage1 or Stage2 from hand if possible.
     * We'll do repeated passes in case evolving one leads to another possibility.
     */
    evolvePokemon (inPlay, hand, currentTurn) {
      let didEvolve = true
      while (didEvolve) {
        didEvolve = false

        for (let i = 0; i < hand.length; i++) {
          const evoName = hand[i]
          if (!this.isPokemon(evoName)) continue

          const evoStage = this.getStage(evoName)
          if (evoStage === 'Basic') continue // can't "evolve" a Basic

          // For "Stage1" or "Stage2", look up the needed pre-evo
          const preEvoName = this.getEvolveFrom(evoName)
          if (!preEvoName) continue // not known

          // find that pre-evo in inPlay for at least 1 turn
          const preEvoInPlay = inPlay.find(
            p => p.name === preEvoName && p.turnPlayed < currentTurn
          )
          if (preEvoInPlay) {
            // remove from hand
            hand.splice(i, 1)
            i--
            // remove the pre-evo from inPlay
            const idxInPlay = inPlay.indexOf(preEvoInPlay)
            inPlay.splice(idxInPlay, 1)
            // add the evolved form
            inPlay.push({
              name: evoName,
              stage: evoStage,
              turnPlayed: currentTurn
            })
            didEvolve = true
            break
          }
        }
      }
    },

    /**
     * This is called when the user presses "Run Simulation"
     */
    runSimulation () {
      // 0) Clear the log
      this.clearLog()

      // 1) Build the deck array from deckSelect choices
      const chosenDeckLabels = this.deckSelectInstance
        .getValue(true)
        .map(item => item.value || item)

      const deckArray = []
      chosenDeckLabels.forEach(lbl => {
        // "(A1-001) Bulbasaur 2x" => baseName="Bulbasaur", copies=2
        const { baseName, count } = this.parseLabel(lbl)
        for (let i = 0; i < count; i++) {
          deckArray.push(baseName)
        }
      })

      // A deck should be 20 cards, so we'll pad it with Placeholder cards
      while (deckArray.length < 20) {
        deckArray.push('Placeholder')
      }

      // 2) Gather all target groups (each is an array of card names)
      //    Example: [ ["Ninetails","Blaine"], ["SomeOtherCard"] ]
      const allTargetSets = this.targetGroups.map(group => {
        if (!group.choicesInstance) return []
        return group.choicesInstance
          .getValue(true)
          .map(item => item.value || item)
      })

      // 3) Run the simulation
      this.logInfo('=== Running Simulation ===')
      const numGames = 10000
      const distribution = this.simulateMultipleGames(
        deckArray,
        allTargetSets,
        numGames
      )

      // 4) Log or display the distribution
      this.logInfo('=== Simulation Distribution ===')
      distribution.forEach((val, turn) => {
        const pct = (val * 100).toFixed(1)
        this.logInfo(
          `Turn ${turn}: ${Math.floor(val * numGames)}/${numGames} (${pct}%)`
        )
      })
    },

    /**
     * @param {string[]} deckArray    e.g. ["Vulpix","Vulpix","Pokeball",...]
     * @param {string[]} targetSets  e.g. [["Ninetails","Blaine"], ["Magmar","Blaine"]]
     * @param {number} numGames       default=1000
     * @returns {number[]} distribution array (length = MAX_TURNS+1)
     *    distribution[t] = fraction (0..1) of games that meet the target by turn t
     *    The result distribution is for "success in at least one target set" by turn T.
     */
    simulateMultipleGames (deckArray, targetSets, numGames) {
      this.logInfo(`Simulating ${numGames} games...`)
      const MAX_TURNS = 10
      const earliestTurns = []

      for (let i = 0; i < numGames; i++) {
        let turnMet
        try {
          turnMet = this.singleGameSimulation(deckArray, targetSets, MAX_TURNS)
        } catch (err) {
          this.logError(`Error in game ${i + 1}: ${err.message}`)
          // abort
          return new Array(MAX_TURNS + 1).fill(0)
        }
        earliestTurns.push(turnMet)
      }

      // distribution[t] = fraction of sims that succeed BY turn t
      const distribution = new Array(MAX_TURNS + 1).fill(0)

      for (let et of earliestTurns) {
        if (et === null) {
          continue // never succeeded
        }
        for (let t = et; t <= MAX_TURNS; t++) {
          distribution[t]++
        }
      }

      for (let t = 0; t <= MAX_TURNS; t++) {
        distribution[t] = distribution[t] / numGames
      }
      return distribution
    },

    /**
     * Place *all* Basic Pokemon from the hand. Don't worry about bench size.
     */
    playAllBasics (inPlay, hand, currentTurn) {
      // We'll repeatedly scan the hand for a Basic that's in the target list.
      // Each time we find one, we move it from hand -> inPlay.
      let keepGoing = true
      while (keepGoing) {
        keepGoing = false

        // Find index of a Basic that is in targetNames
        const idx = hand.findIndex(cn => this.isBasicPokemon(cn))

        if (idx !== -1) {
          // Move that card from hand to inPlay
          const basicName = hand.splice(idx, 1)[0]
          inPlay.push({
            name: basicName,
            stage: 'Basic',
            turnPlayed: currentTurn
          })
          keepGoing = true
        }
      }
    },

    /**
     * Simulate ONE game up to maxTurns:
     *  - Mulligan for opening 5 until we have at least 1 Basic
     *  - Each turn:
     *      1) Draw 1
     *      2) Use all Poké Balls
     *      3) Use exactly 1 Professor's Research if available (limit 1)
     *      4) Play Basic if none in play
     *      5) Evolve if possible (Stage1 or Stage2) from a prior-turn pre-evo
     *      6) Check if targets are met
     *
     * @returns {number|null} earliest turn (0..maxTurns) success, or null if never
     */
    singleGameSimulation (deckArray, targetSets, maxTurns) {
      // (unchanged mulligan, shuffle, etc. from your original)
      // ...
      let deck = deckArray.slice()
      this.shuffle(deck)

      // Mulligan logic (unchanged)
      let hand = []
      while (true) {
        hand = deck.splice(0, 5)
        if (hand.some(cn => this.isBasicPokemon(cn))) {
          break
        } else {
          deck.push(...hand)
          this.shuffle(deck)
        }
      }

      let inPlay = []
      // Immediately play basics
      this.playAllBasics(inPlay, hand, 0)

      // Check at turn 0
      if (this.checkAnyTargetSetMet(targetSets, hand, inPlay)) {
        return 0
      }

      for (let turn = 1; turn <= maxTurns; turn++) {
        // draw 1
        if (deck.length > 0) {
          hand.push(deck.shift())
        }
        // use pokeballs
        this.useAllPokeballs(hand, deck)
        // research
        this.useOneProfessorResearch(hand, deck)
        // play basics
        this.playAllBasics(inPlay, hand, turn)
        // evolve
        this.evolvePokemon(inPlay, hand, turn)

        // Check
        if (this.checkAnyTargetSetMet(targetSets, hand, inPlay)) {
          return turn
        }
      }

      return null
    },

    /**
     * OR-logic check: If ANY group is satisfied, return true.
     */
    checkAnyTargetSetMet (targetSets, hand, inPlay) {
      // If there's at least one group fully met => success
      return targetSets.some(group =>
        this.checkSingleTargetSetMet(group, hand, inPlay)
      )
    },

    /**
     * Check if *one* group’s targets are all satisfied:
     *   - If target is a Pokemon => must be in inPlay
     *   - If target is a Trainer => must be in hand
     */
    checkSingleTargetSetMet (targetNames, hand, inPlay) {
      for (let tName of targetNames) {
        const { baseName } = this.parseLabel(tName)
        if (this.isPokemon(baseName)) {
          const found = inPlay.some(p => p.name === baseName)
          if (!found) return false
        } else if (this.isTrainer(baseName)) {
          if (!hand.includes(baseName)) return false
        } else {
          throw new Error(`Unknown target type: ${baseName}`)
        }
      }
      return true
    }
  }
}
