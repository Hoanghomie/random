import BattleScene, { PokeballCounts } from "../battle-scene";
import { Gender } from "../data/gender";
import Pokemon, { EnemyPokemon, PlayerPokemon } from "../pokemon";
import { pokemonPrevolutions } from "../data/pokemon-evolutions";
import PokemonSpecies, { allSpecies, getPokemonSpecies } from "../data/pokemon-species";
import { Species } from "../data/species";
import * as Utils from "../utils";
import PokemonData from "./pokemon-data";
import PersistentModifierData from "./modifier-data";
import { PokemonHeldItemModifier } from "../modifier/modifier";
import ArenaData from "./arena-data";
import { Unlockables } from "./unlockables";

interface SystemSaveData {
  trainerId: integer;
  secretId: integer;
  dexData: DexData;
  unlocks: Unlocks;
  timestamp: integer;
}

interface SessionSaveData {
  party: PokemonData[];
  enemyField: PokemonData[];
  modifiers: PersistentModifierData[];
  enemyModifiers: PersistentModifierData[];
  arena: ArenaData;
  pokeballCounts: PokeballCounts;
  waveIndex: integer;
  timestamp: integer;
}

interface Unlocks {
  [key: integer]: boolean;
}

export interface DexData {
  [key: integer]: DexData | DexEntry
}

export interface DexEntry {
  seen: boolean;
  caught: boolean;
}

export interface DexEntryDetails {
  shiny: boolean;
  formIndex: integer;
  female: boolean;
  abilityIndex: integer;
  entry: DexEntry;
}

export interface StarterDexUnlockTree {
  shiny: boolean | Map<boolean, StarterDexUnlockTree>
  formIndex: integer | Map<integer, StarterDexUnlockTree>
  female: boolean | Map<boolean, StarterDexUnlockTree>
  abilityIndex: integer | Map<integer, StarterDexUnlockTree>
  key: string,
  entry: DexEntry
}

export class GameData {
  private scene: BattleScene;

  public trainerId: integer;
  public secretId: integer;
  
  public dexData: DexData;

  public unlocks: Unlocks;

  constructor(scene: BattleScene) {
    this.scene = scene;
    this.trainerId = Utils.randInt(65536);
    this.secretId = Utils.randInt(65536);
    this.unlocks = {
      [Unlockables.MINI_BLACK_HOLE]: false
    };
    this.initDexData();
    this.loadSystem();
  }

  public saveSystem(): boolean {
    if (this.scene.quickStart)
      return false;
      
    const data: SystemSaveData = {
      trainerId: this.trainerId,
      secretId: this.secretId,
      dexData: this.dexData,
      unlocks: this.unlocks,
      timestamp: new Date().getTime()
    };

    localStorage.setItem('data', btoa(JSON.stringify(data)));

    return true;
  }

  private loadSystem(): boolean {
    if (!localStorage.getItem('data'))
      return false;

    const data = JSON.parse(atob(localStorage.getItem('data'))) as SystemSaveData;
    console.debug(data);

    this.trainerId = data.trainerId;
    this.secretId = data.secretId;

    if (data.unlocks) {
      for (let key of Object.keys(data.unlocks)) {
        if (this.unlocks.hasOwnProperty(key))
          this.unlocks[key] = data.unlocks[key];
      }
    }

    if (data.timestamp === undefined)
      this.convertDexData(data.dexData);

    this.dexData = Object.assign(this.dexData, data.dexData);

    return true;
  }

  saveSession(scene: BattleScene): boolean {
    const sessionData = {
      party: scene.getParty().map(p => new PokemonData(p)),
      enemyField: scene.getEnemyField().map(p => new PokemonData(p)),
      modifiers: scene.findModifiers(() => true).map(m => new PersistentModifierData(m, true)),
      enemyModifiers: scene.findModifiers(() => true, false).map(m => new PersistentModifierData(m, false)),
      arena: new ArenaData(scene.arena),
      pokeballCounts: scene.pokeballCounts,
      waveIndex: scene.currentBattle.waveIndex,
      timestamp: new Date().getTime()
    } as SessionSaveData;

    localStorage.setItem('sessionData', btoa(JSON.stringify(sessionData)));

    console.debug('Session data saved');

    return true;
  }

  hasSession() {
    return !!localStorage.getItem('sessionData');
  }

  loadSession(scene: BattleScene): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      if (!this.hasSession())
        return resolve(false);

      try {
        const sessionData = JSON.parse(atob(localStorage.getItem('sessionData')), (k: string, v: any) => {
          if (k === 'party' || k === 'enemyField') {
            const ret: PokemonData[] = [];
            for (let pd of v)
              ret.push(new PokemonData(pd));
            return ret;
          }

          if (k === 'modifiers' || k === 'enemyModifiers') {
            const player = k === 'modifiers';
            const ret: PersistentModifierData[] = [];
            for (let md of v)
              ret.push(new PersistentModifierData(md, player));
            return ret;
          }

          if (k === 'arena')
            return new ArenaData(v);

          return v;
        }) as SessionSaveData;

        console.debug(sessionData);

        const loadPokemonAssets: Promise<void>[] = [];

        const party = scene.getParty();
        party.splice(0, party.length);

        for (let p of sessionData.party) {
          const pokemon = p.toPokemon(scene) as PlayerPokemon;
          pokemon.setVisible(false);
          loadPokemonAssets.push(pokemon.loadAssets());
          party.push(pokemon);
        }

        Object.keys(scene.pokeballCounts).forEach((key: string) => {
          scene.pokeballCounts[key] = sessionData.pokeballCounts[key] || 0;
        });

        scene.newArena(sessionData.arena.biome, sessionData.enemyField.length > 1);
        const battle = scene.newBattle(sessionData.waveIndex, sessionData.enemyField.length > 1);

        sessionData.enemyField.forEach((enemyData, e) => {
          const enemyPokemon = enemyData.toPokemon(scene) as EnemyPokemon;
          battle.enemyField[e] = enemyPokemon;

          loadPokemonAssets.push(enemyPokemon.loadAssets());
        });

        scene.arena.weather = sessionData.arena.weather;
        // TODO
        //scene.arena.tags = sessionData.arena.tags;

        const modifiersModule = await import('../modifier/modifier');

        for (let modifierData of sessionData.modifiers) {
          const modifier = modifierData.toModifier(scene, modifiersModule[modifierData.className]);
          if (modifier)
            scene.addModifier(modifier);
        }

        for (let enemyModifierData of sessionData.enemyModifiers) {
          const modifier = enemyModifierData.toModifier(scene, modifiersModule[enemyModifierData.className]) as PokemonHeldItemModifier;
          if (modifier)
            scene.addEnemyModifier(modifier);
        }

        Promise.all(loadPokemonAssets).then(() => resolve(true));
      } catch (err) {
        reject(err);
        return;
      }
    });
  }

  clearSession(): void {
    localStorage.removeItem('sessionData');
  }

  private initDexData(): void {
    const data: DexData = {};

    const initDexSubData = (dexData: DexData, count: integer): DexData[] => {
      const ret: DexData[] = [];
      for (let i = 0; i < count; i++) {
        const newData: DexData = {};
        dexData[i] = newData;
        ret.push(newData);
      }

      return ret;
    };

    const initDexEntries = (dexData: DexData, count: integer): DexEntry[] => {
      const ret: DexEntry[] = [];
      for (let i = 0; i < count; i++) {
        const entry: DexEntry = { seen: false, caught: false };
        dexData[i] = entry;
        ret.push(entry);
      }

      return ret;
    };

    for (let species of allSpecies) {
      data[species.speciesId] = {};
      const abilityCount = species.getAbilityCount();
      if (species.forms?.length)
        initDexSubData(data[species.speciesId] as DexData, 2).map(sd => species.malePercent !== null
          ? initDexSubData(sd, species.forms.length).map(fd => initDexSubData(fd, 2).map(gd => initDexEntries(gd, abilityCount)))
          : initDexSubData(sd, species.forms.length).map(fd => initDexEntries(fd, abilityCount)));
      else if (species.malePercent !== null)
        initDexSubData(data[species.speciesId] as DexData, 2).map(sd => initDexSubData(sd, 2).map(gd => initDexEntries(gd, abilityCount)));
      else
        initDexSubData(data[species.speciesId] as DexData, 2).map(sd => initDexEntries(sd, abilityCount))
    }

    const defaultStarters: Species[] = [
      Species.BULBASAUR, Species.CHARMANDER, Species.SQUIRTLE,
      Species.CHIKORITA, Species.CYNDAQUIL, Species.TOTODILE,
      Species.TREECKO, Species.TORCHIC, Species.MUDKIP,
      Species.TURTWIG, Species.CHIMCHAR, Species.PIPLUP,
      Species.SNIVY, Species.TEPIG, Species.OSHAWOTT
    ];

    for (let ds of defaultStarters) {
      let entry = data[ds][0][Gender.MALE][0] as DexEntry;
      entry.seen = true;
      entry.caught = true;
    }

    this.dexData = data;
  }

  setPokemonSeen(pokemon: Pokemon): void {
    const dexEntry = this.getPokemonDexEntry(pokemon);
    if (!dexEntry.seen) {
      dexEntry.seen = true;
      this.saveSystem();
    }
  }

  setPokemonCaught(pokemon: Pokemon): Promise<void> {
    return new Promise(resolve => {
      const dexEntry = this.getPokemonDexEntry(pokemon);
      if (!dexEntry.caught) {
        const newCatch = !this.getDefaultDexEntry(pokemon.species);

        dexEntry.caught = true;
        this.saveSystem();

        if (newCatch && !pokemonPrevolutions.hasOwnProperty(pokemon.species.speciesId)) {
          this.scene.playSoundWithoutBgm('level_up_fanfare', 1500);
          this.scene.ui.showText(`${pokemon.name} has been\nadded as a starter!`, null, () => resolve(), null, true);
          return;
        }
      }

      resolve();
    });
  }

  getPokemonDexEntry(pokemon: Pokemon) {
    return this.getDexEntry(pokemon.species, pokemon.shiny, pokemon.formIndex, pokemon.gender === Gender.FEMALE, pokemon.abilityIndex);
  }

  getDexEntry(species: PokemonSpecies, shiny: boolean, formIndex: integer, female: boolean, abilityIndex: integer): DexEntry {
    const shinyIndex = !shiny ? 0 : 1;
    const genderIndex = !female ? 0 : 1;
    const data = this.dexData[species.speciesId];
    if (species.forms?.length) {
      if (species.malePercent !== null)
        return data[shinyIndex][formIndex][genderIndex][abilityIndex];
      return data[shinyIndex][formIndex][abilityIndex];
    } else if (species.malePercent !== null)
      return data[shinyIndex][genderIndex][abilityIndex];
    return data[shinyIndex][abilityIndex] as DexEntry;
  }

  getDefaultDexEntry(species: PokemonSpecies, forceShiny?: boolean, forceFormIndex?: integer, forceFemale?: boolean, forceAbilityIndex?: integer): DexEntryDetails {
    const hasForms = !!species.forms?.length;
    const hasGender = species.malePercent !== null;
    let shiny = false;
    let formIndex = 0;
    let female = false;
    let abilityIndex = 0;
    let entry = null;

    const traverseData = (data: DexData, level: integer) => {
      const keys = Object.keys(data);
      if ((!hasForms && level === 1) || (!hasGender && level === 2)) {
        traverseData(data, level + 1);
        return;
      }
      keys.forEach((key: string, k: integer) => {
        if (entry)
          return;

        switch (level) {
          case 0:
            shiny = !!k;
            if (forceShiny !== undefined && shiny !== forceShiny)
              return;
            break;
          case 1:
            formIndex = k;
            if (forceFormIndex !== undefined && formIndex !== forceFormIndex)
              return;
            break;
          case 2:
            female = !!k;
            if (forceFemale !== undefined && female !== forceFemale)
              return
            break;
          case 3:
            abilityIndex = k;
            if (forceAbilityIndex !== undefined && abilityIndex !== forceAbilityIndex)
              return;
            break;
        }

        if ('caught' in data[key]) {
          if (data[key].caught)
            entry = data[key] as DexEntry;
        } else
          traverseData(data[key] as DexData, level + 1);
      });
    };

    traverseData(this.dexData[species.speciesId] as DexData, 0);

    if (entry) {
      return {
        shiny: shiny,
        formIndex: formIndex,
        female: female,
        abilityIndex: abilityIndex,
        entry: entry
      };
    }

    return null;
  }

  getStarterDexUnlockTree(species: PokemonSpecies): StarterDexUnlockTree {
    const hasForms = !!species.forms?.length;
    const hasGender = species.malePercent !== null;

    const getTreeOrValueMap = (key: string, parent?: StarterDexUnlockTree): (Map<any, any>) => {
      switch (key) {
        case 'shiny':
          const shinyMap = new Map<boolean, StarterDexUnlockTree>();
          for (let s = 0; s < 2; s++) {
            const props = { shiny: !!s };
            shinyMap.set(!!s, {
              shiny: !!s,
              formIndex: hasForms ? getTreeOrValueMap('formIndex', props as StarterDexUnlockTree) : null,
              female: !hasForms && hasGender ? getTreeOrValueMap('female', props as StarterDexUnlockTree) : null,
              abilityIndex: !hasForms && !hasGender ? getTreeOrValueMap('abilityIndex', props as StarterDexUnlockTree) : null,
              key: hasForms ? 'formIndex' : hasGender ? 'female' : 'abilityIndex',
              entry: null,
            });
          }
          return shinyMap;
        case 'formIndex':
          const formMap = new Map<integer, StarterDexUnlockTree>();
          for (let f = 0; f < species.forms.length; f++) {
            const props = { shiny: parent.shiny, formIndex: f };
            formMap.set(f, {
              shiny: parent.shiny,
              formIndex: f,
              female: hasGender ? getTreeOrValueMap('female', props as StarterDexUnlockTree) : null,
              abilityIndex: !hasGender ? getTreeOrValueMap('abilityIndex', props as StarterDexUnlockTree) : null,
              key: hasGender ? 'female' : 'abilityIndex',
              entry: null
            });
          }
          return formMap;
        case 'female':
          const genderMap = new Map<boolean, StarterDexUnlockTree>();
          for (let g = 0; g < 2; g++) {
            const props = { shiny: parent.shiny, formIndex: parent.formIndex, female: !!g };
            genderMap.set(!!g, {
              shiny: parent.shiny,
              formIndex: parent.formIndex,
              female: !!g,
              abilityIndex: getTreeOrValueMap('abilityIndex', props as StarterDexUnlockTree),
              key: 'abilityIndex',
              entry: null
            });
          }
          return genderMap;
        case 'abilityIndex':
          const abilityMap = new Map<integer, StarterDexUnlockTree>();
          const abilityCount = species.getAbilityCount();
          for (let a = 0; a < abilityCount; a++) {
            abilityMap.set(a, {
              shiny: parent.shiny,
              formIndex: parent.formIndex,
              female: parent.female,
              abilityIndex: a,
              key: 'entry',
              entry: hasForms
                ? hasGender
                  ? this.dexData[species.speciesId][!parent.shiny ? 0 : 1][parent.formIndex as integer][!parent.female ? 0 : 1][a]
                  : this.dexData[species.speciesId][!parent.shiny ? 0 : 1][parent.formIndex as integer][a]
                : hasGender
                  ? this.dexData[species.speciesId][!parent.shiny ? 0 : 1][!parent.female ? 0 : 1][a]
                  : this.dexData[species.speciesId][!parent.shiny ? 0 : 1][a]
            });
          }
          return abilityMap;
      }
    };

    const root = {
      shiny: getTreeOrValueMap('shiny'),
      formIndex: null,
      female: null,
      abilityIndex: null,
      key: 'shiny',
      entry: null
    };

    return root;
  }

  convertDexData(dexData: DexData): void {
    const traverseData = (speciesId: Species, data: DexData) => {
      const keys = Object.keys(data);
      keys.forEach((key: string, k: integer) => {
        if ('caught' in data[key]) {
          const abilityCount = getPokemonSpecies(speciesId).getAbilityCount();
          data[key] = {
            0: data[key]
          };
          for (let a = 1; a < abilityCount; a++)
            data[key][a] = { seen: false, caught: false };
        } else
          traverseData(speciesId, data[key]);
      });
    }

    Object.keys(dexData).forEach((species: string, s: integer) => {
      const speciesId = parseInt(species);
      traverseData(speciesId, dexData[species]);
    });
  }
}