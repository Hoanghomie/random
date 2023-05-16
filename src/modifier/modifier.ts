import * as ModifierTypes from './modifier-type';
import { LearnMovePhase, LevelUpPhase, PokemonHealPhase } from "../battle-phases";
import BattleScene, { maxExpLevel } from "../battle-scene";
import { getLevelTotalExp } from "../data/exp";
import { PokeballType } from "../data/pokeball";
import Pokemon, { PlayerPokemon } from "../pokemon";
import { Stat } from "../data/pokemon-stat";
import { addTextObject, TextStyle } from "../ui/text";
import { Type } from '../data/type';
import { EvolutionPhase } from '../evolution-phase';
import { pokemonEvolutions } from '../data/pokemon-evolutions';
import { getPokemonMessage } from '../messages';
import * as Utils from "../utils";
import { TempBattleStat } from '../data/temp-battle-stat';
import { BerryType, getBerryEffectFunc, getBerryPredicate } from '../data/berry';
import { Species } from '../data/species';

type ModifierType = ModifierTypes.ModifierType;
export type ModifierPredicate = (modifier: Modifier) => boolean;

export class ModifierBar extends Phaser.GameObjects.Container {
  private player: boolean;

  constructor(scene: BattleScene, enemy?: boolean) {
    super(scene, 1 + (enemy ? 302 : 0), 2);

    this.player = !enemy;
    this.setScale(0.5);
  }

  updateModifiers(modifiers: PersistentModifier[]) {
    this.removeAll(true);

    for (let modifier of modifiers) {
      const icon = modifier.getIcon(this.scene as BattleScene);
      this.add(icon);
      this.setModifierIconPosition(icon, modifiers.length);
    }
  }

  setModifierIconPosition(icon: Phaser.GameObjects.Container, modifierCount: integer) {
    let rowIcons: integer = 12 + 6 * Math.max((Math.ceil(modifierCount / 12) - 2), 0);

    const x = (this.getIndex(icon) % rowIcons) * 26 / (rowIcons / 12);
    const y = Math.floor(this.getIndex(icon) / rowIcons) * 20;

    icon.setPosition(this.player ? x : -x, y);
  }
}

export abstract class Modifier {
  public type: ModifierType;

  constructor(type: ModifierType) {
    this.type = type;
  }

  match(_modifier: Modifier): boolean {
    return false;
  }

  shouldApply(_args: any[]): boolean {
    return true;
  }

  abstract apply(args: any[]): boolean;
}

export abstract class PersistentModifier extends Modifier {
  public stackCount: integer;
  public virtualStackCount: integer;

  constructor(type: ModifierType, stackCount: integer) {
    super(type);
    this.stackCount = stackCount === undefined ? 1 : stackCount;
    this.virtualStackCount = 0;
  }

  add(modifiers: PersistentModifier[], virtual: boolean): boolean {
    for (let modifier of modifiers) {
      if (this.match(modifier))
        return modifier.incrementStack(this.stackCount, virtual);
    }

    if (virtual) {
      this.virtualStackCount += this.stackCount;
      this.stackCount = 0;
    }
    modifiers.push(this);
    return true;
  }

  abstract clone(): PersistentModifier;

  getArgs(): any[] {
    return [];
  }

  incrementStack(amount: integer, virtual: boolean): boolean {
    if (this.getStackCount() + amount <= this.getMaxStackCount()) {
      if (!virtual)
        this.stackCount += amount;
      else
        this.virtualStackCount += amount;
      return true;
    }

    return false;
  }

  getStackCount(): integer {
    return this.stackCount + this.virtualStackCount;
  }

  getMaxStackCount(): integer {
    return 99;
  }

  getIcon(scene: BattleScene, forSummary?: boolean): Phaser.GameObjects.Container {
    const container = scene.add.container(0, 0);

    const item = scene.add.sprite(0, 12, 'items');
    item.setFrame(this.type.iconImage);
    item.setOrigin(0, 0.5);
    container.add(item);

    const stackText = this.getIconStackText(scene);
    if (stackText)
      container.add(stackText);

    const virtualStackText = this.getIconStackText(scene, true);
    if (virtualStackText)
      container.add(virtualStackText);

    return container;
  }

  getIconStackText(scene: BattleScene, virtual?: boolean): Phaser.GameObjects.Text {
    if (this.getMaxStackCount() === 1 || (virtual && !this.virtualStackCount))
      return null;

    const isStackMax = this.getStackCount() >= this.getMaxStackCount();
    const maxColor = '#f89890';
    const maxStrokeColor = '#984038';

    if (virtual) {
      const virtualText = addTextObject(scene, 27, 12, `+${this.virtualStackCount.toString()}`, TextStyle.PARTY, { fontSize: '66px', color: !isStackMax ? '#40c8f8' : maxColor });
      virtualText.setShadow(0, 0, null);
      virtualText.setStroke(!isStackMax ? '#006090' : maxStrokeColor, 16)
      virtualText.setOrigin(1, 0);

      return virtualText;
    }

    const text = addTextObject(scene, 8, 12, this.stackCount.toString(), TextStyle.PARTY, { fontSize: '66px', color: !isStackMax ? '#f8f8f8' : maxColor });
    text.setShadow(0, 0, null);
    text.setStroke('#424242', 16)
    text.setOrigin(0, 0);

    return text;
  }
}

export abstract class ConsumableModifier extends Modifier {
  constructor(type: ModifierType) {
    super(type);
  }

  add(_modifiers: Modifier[]): boolean {
    return true;
  }

  shouldApply(args: any[]): boolean {
    return super.shouldApply(args) && args.length === 1 && args[0] instanceof BattleScene;
  }
}

export class AddPokeballModifier extends ConsumableModifier {
  private pokeballType: PokeballType;
  private count: integer;

  constructor(type: ModifierType, pokeballType: PokeballType, count: integer) {
    super(type);

    this.pokeballType = pokeballType;
    this.count = count;
  }

  apply(args: any[]): boolean {
    const pokeballCounts = (args[0] as BattleScene).pokeballCounts;
    pokeballCounts[this.pokeballType] = Math.min(pokeballCounts[this.pokeballType] + this.count, 99);

    return true;
  }
}

export class TempBattleStatBoosterModifier extends PersistentModifier {
  private tempBattleStat: TempBattleStat;
  private battlesLeft: integer;

  constructor(type: ModifierTypes.TempBattleStatBoosterModifierType, tempBattleStat: TempBattleStat, battlesLeft?: integer, stackCount?: integer) {
    super(type, stackCount);

    this.tempBattleStat = tempBattleStat;
    this.battlesLeft = battlesLeft || 5;
  }

  clone(): TempBattleStatBoosterModifier {
    return new TempBattleStatBoosterModifier(this.type as ModifierTypes.TempBattleStatBoosterModifierType, this.tempBattleStat, this.stackCount);
  }

  getArgs(): any[] {
    return [ this.tempBattleStat, this.battlesLeft ];
  }

  apply(args: any[]): boolean {
    const tempBattleStat = args[0] as TempBattleStat;

    if (tempBattleStat === this.tempBattleStat) {
      const statLevel = args[1] as Utils.IntegerHolder;
      statLevel.value = Math.min(statLevel.value + 1, 6);
      return true;
    }

    return false;
  }

  lapse(): boolean {
    return !!--this.battlesLeft;
  }

  getIcon(scene: BattleScene): Phaser.GameObjects.Container {
    const container = super.getIcon(scene);

    const battleCountText = addTextObject(scene, 27, 0, this.battlesLeft.toString(), TextStyle.PARTY, { fontSize: '66px', color: '#f89890' });
    battleCountText.setShadow(0, 0, null);
    battleCountText.setStroke('#984038', 16)
    battleCountText.setOrigin(1, 0);
    container.add(battleCountText);

    return container;
  }
}

export class MapModifier extends PersistentModifier {
  constructor(type: ModifierType, stackCount?: integer) {
    super(type, stackCount);
  }
  
  clone(): MapModifier {
    return new MapModifier(this.type, this.stackCount);
  }

  apply(args: any[]): boolean {
    return true;
  }

  getmaxStackCount(): integer {
    return 1;
  }
}

export abstract class PokemonHeldItemModifier extends PersistentModifier {
  public pokemonId: integer;

  constructor(type: ModifierType, pokemonId: integer, stackCount: integer) {
    super(type, stackCount);

    this.pokemonId = pokemonId;
  }

  abstract matchType(_modifier: Modifier): boolean;

  match(modifier: Modifier) {
    return this.matchType(modifier) && (modifier as PokemonHeldItemModifier).pokemonId === this.pokemonId;
  }

  getArgs(): any[] {
    return [ this.pokemonId ];
  }

  shouldApply(args: any[]): boolean {
    return super.shouldApply(args) && args.length && args[0] instanceof Pokemon && (this.pokemonId === -1 || (args[0] as Pokemon).id === this.pokemonId);
  }

  getIcon(scene: BattleScene, forSummary?: boolean): Phaser.GameObjects.Container {
    const container = !forSummary ? scene.add.container(0, 0) : super.getIcon(scene);

    if (!forSummary) {
      const pokemon = this.getPokemon(scene);
      const pokemonIcon = scene.add.sprite(0, 8, pokemon.species.getIconAtlasKey());
      if (pokemon.species.isObtainable())
        pokemonIcon.play(pokemon.getIconKey()).stop();
      else {
        if (pokemon.species.speciesId === Species.ETERNATUS)
          pokemonIcon.setScale(0.5, 0.5);
        else
         pokemonIcon.setPosition(-8, 0);
        pokemonIcon.setFrame(pokemon.getIconId());
      }
      pokemonIcon.setOrigin(0, 0.5);

      container.add(pokemonIcon);

      const item = scene.add.sprite(16, this.virtualStackCount ? 8 : 16, 'items');
      item.setScale(0.5);
      item.setOrigin(0, 0.5);
      item.setTexture('items', this.type.iconImage);
      container.add(item);

      const stackText = this.getIconStackText(scene);
      if (stackText)
        container.add(stackText);

      const virtualStackText = this.getIconStackText(scene, true);
      if (virtualStackText)
        container.add(virtualStackText);
    } else
      container.setScale(0.5);

    return container;
  }

  getPokemon(scene: BattleScene): Pokemon {
    return scene.getPokemonById(this.pokemonId);
  }
}

export class PokemonBaseStatModifier extends PokemonHeldItemModifier {
  protected stat: Stat;

  constructor(type: ModifierTypes.PokemonBaseStatBoosterModifierType, pokemonId: integer, stat: Stat, stackCount?: integer) {
    super(type, pokemonId, stackCount);
    this.stat = stat;
  }

  matchType(modifier: Modifier): boolean {
    if (modifier instanceof PokemonBaseStatModifier)
      return (modifier as PokemonBaseStatModifier).stat === this.stat;
    return false;
  }

  clone(): PersistentModifier {
    return new PokemonBaseStatModifier(this.type as ModifierTypes.PokemonBaseStatBoosterModifierType, this.pokemonId, this.stat, this.stackCount);
  }

  getArgs(): any[] {
    return super.getArgs().concat(this.stat);
  }

  shouldApply(args: any[]): boolean {
    return super.shouldApply(args) && args.length === 2 && args[1] instanceof Array<integer>;
  }

  apply(args: any[]): boolean {
    args[1][this.stat] = Math.min(Math.floor(args[1][this.stat] * (1 + this.getStackCount() * 0.2)), 999999);

    return true;
  }
}

export class AttackTypeBoosterModifier extends PokemonHeldItemModifier {
  private moveType: Type;
  private boostMultiplier: number;

  constructor(type: ModifierType, pokemonId: integer, moveType: Type, boostPercent: integer, stackCount?: integer) {
    super(type, pokemonId, stackCount);

    this.moveType = moveType;
    this.boostMultiplier = boostPercent * 0.01;
  }

  matchType(modifier: Modifier) {
    if (modifier instanceof AttackTypeBoosterModifier) {
      const attackTypeBoosterModifier = modifier as AttackTypeBoosterModifier;
      return attackTypeBoosterModifier.moveType === this.moveType && attackTypeBoosterModifier.boostMultiplier === this.boostMultiplier;
    }
  }

  clone() {
    return new AttackTypeBoosterModifier(this.type, this.pokemonId, this.moveType, this.boostMultiplier * 100, this.stackCount);
  }

  getArgs(): any[] {
    return super.getArgs().concat([ this.moveType, this.boostMultiplier * 100 ]);
  }

  shouldApply(args: any[]): boolean {
    return super.shouldApply(args) && args.length === 2 && args[1] instanceof Utils.NumberHolder;
  }

  apply(args: any[]): boolean {
    (args[1] as Utils.NumberHolder).value = Math.floor((args[1] as Utils.NumberHolder).value * (1 + (this.getStackCount() * this.boostMultiplier)));

    return true;
  }
}

export class SurviveDamageModifier extends PokemonHeldItemModifier {
  constructor(type: ModifierType, pokemonId: integer, stackCount?: integer) {
    super(type, pokemonId, stackCount);
  }

  matchType(modifier: Modifier) {
    return modifier instanceof SurviveDamageModifier;
  }

  clone() {
    return new SurviveDamageModifier(this.type, this.pokemonId, this.stackCount);
  }

  shouldApply(args: any[]): boolean {
    return super.shouldApply(args) && args.length === 2 && args[1] instanceof Utils.BooleanHolder;
  }

  apply(args: any[]): boolean {
    const pokemon = args[0] as Pokemon;
    const surviveDamage = args[1] as Utils.BooleanHolder;

    if (!surviveDamage.value && Utils.randInt(10) < this.getStackCount()) {
      surviveDamage.value = true;

      pokemon.scene.queueMessage(getPokemonMessage(pokemon, ` hung on\nusing its ${this.type.name}!`));
    }

    return true;
  }

  getmaxStackCount(): integer {
    return 5;
  }
}

export class FlinchChanceModifier extends PokemonHeldItemModifier {
  constructor(type: ModifierType, pokemonId: integer, stackCount?: integer) {
    super(type, pokemonId, stackCount);
  }

  matchType(modifier: Modifier) {
    return modifier instanceof FlinchChanceModifier;
  }

  clone() {
    return new FlinchChanceModifier(this.type, this.pokemonId, this.stackCount);
  }

  shouldApply(args: any[]): boolean {
    return super.shouldApply(args) && args.length === 2 && args[1] instanceof Utils.BooleanHolder;
  }

  apply(args: any[]): boolean {
    const flinched = args[1] as Utils.BooleanHolder;

    if (!flinched.value && Utils.randInt(10) < this.getStackCount())
      flinched.value = true;

    return true;
  }

  getmaxStackCount(): integer {
    return 3;
  }
}

export class TurnHealModifier extends PokemonHeldItemModifier {
  constructor(type: ModifierType, pokemonId: integer, stackCount?: integer) {
    super(type, pokemonId, stackCount);
  }

  matchType(modifier: Modifier) {
    return modifier instanceof TurnHealModifier;
  }

  clone() {
    return new TurnHealModifier(this.type, this.pokemonId, this.stackCount);
  }

  apply(args: any[]): boolean {
    const pokemon = args[0] as Pokemon;

    if (pokemon.getHpRatio() < 1) {
      const scene = pokemon.scene;
      scene.unshiftPhase(new PokemonHealPhase(scene, pokemon.getBattlerIndex(),
        Math.max(Math.floor(pokemon.getMaxHp() / 16) * this.stackCount, 1), getPokemonMessage(pokemon, `'s ${this.type.name}\nrestored its HP a little!`), true));
    }

    return true;
  }

  getmaxStackCount(): integer {
    return 4;
  }
}

export class HitHealModifier extends PokemonHeldItemModifier {
  constructor(type: ModifierType, pokemonId: integer, stackCount?: integer) {
    super(type, pokemonId, stackCount);
  }

  matchType(modifier: Modifier) {
    return modifier instanceof HitHealModifier;
  }

  clone() {
    return new HitHealModifier(this.type, this.pokemonId, this.stackCount);
  }

  apply(args: any[]): boolean {
    const pokemon = args[0] as Pokemon;

    if (pokemon.turnData.damageDealt && pokemon.getHpRatio() < 1) {
      const scene = pokemon.scene;
      scene.unshiftPhase(new PokemonHealPhase(scene, pokemon.getBattlerIndex(),
        Math.max(Math.floor(pokemon.turnData.damageDealt / 8) * this.stackCount, 1), getPokemonMessage(pokemon, `'s ${this.type.name}\nrestored its HP a little!`), true));
    }

    return true;
  }

  getmaxStackCount(): integer {
    return 4;
  }
}

export class LevelIncrementBoosterModifier extends PersistentModifier {
  constructor(type: ModifierType, stackCount?: integer) {
    super(type, stackCount);
  }

  match(modifier: Modifier) {
    return modifier instanceof LevelIncrementBoosterModifier;
  }

  clone() {
    return new LevelIncrementBoosterModifier(this.type, this.stackCount);
  }

  shouldApply(args: any[]): boolean {
    return super.shouldApply(args) && args[0] instanceof Utils.IntegerHolder;
  }

  apply(args: any[]): boolean {
    (args[0] as Utils.IntegerHolder).value += this.getStackCount();

    return true;
  }
}

export class BerryModifier extends PokemonHeldItemModifier {
  public berryType: BerryType;
  public consumed: boolean;

  constructor(type: ModifierType, pokemonId: integer, berryType: BerryType, stackCount?: integer) {
    super(type, pokemonId, stackCount);

    this.berryType = berryType;
    this.consumed = false;
  }

  matchType(modifier: Modifier) {
    return modifier instanceof BerryModifier && (modifier as BerryModifier).berryType === this.berryType;
  }

  clone() {
    return new BerryModifier(this.type, this.pokemonId, this.berryType, this.stackCount);
  }

  getArgs(): any[] {
    return super.getArgs().concat(this.berryType);
  }

  shouldApply(args: any[]): boolean {
    return !this.consumed && super.shouldApply(args) && getBerryPredicate(this.berryType)(args[0] as Pokemon);
  }

  apply(args: any[]): boolean {
    const pokemon = args[0] as Pokemon;

    const preserve = new Utils.BooleanHolder(false);
    pokemon.scene.applyModifiers(PreserveBerryModifier, pokemon.isPlayer(), preserve);

    getBerryEffectFunc(this.berryType)(pokemon);
    if (!preserve.value)
      this.consumed = true;

    return true;
  }
}

export class PreserveBerryModifier extends PersistentModifier {
  constructor(type: ModifierType, stackCount?: integer) {
    super(type, stackCount);
  }

  match(modifier: Modifier) {
    return modifier instanceof PreserveBerryModifier;
  }

  clone() {
    return new PreserveBerryModifier(this.type, this.stackCount);
  }

  shouldApply(args: any[]): boolean {
    return super.shouldApply(args) && args[0] instanceof Utils.BooleanHolder;
  }

  apply(args: any[]): boolean {
    if (!(args[0] as Utils.BooleanHolder).value)
      (args[0] as Utils.BooleanHolder).value = this.getStackCount() === this.getMaxStackCount() || Utils.randInt(this.getMaxStackCount()) < this.getStackCount();

    return true;
  }

  getmaxStackCount(): integer {
    return 4;
  }
}

export abstract class ConsumablePokemonModifier extends ConsumableModifier {
  public pokemonId: integer;

  constructor(type: ModifierType, pokemonId: integer) {
    super(type);

    this.pokemonId = pokemonId;
  }

  shouldApply(args: any[]): boolean {
    return args.length && args[0] instanceof PlayerPokemon && (this.pokemonId === -1 || (args[0] as PlayerPokemon).id === this.pokemonId);
  }

  getPokemon(scene: BattleScene) {
    return scene.getParty().find(p => p.id === this.pokemonId);
  }
}

export class PokemonHpRestoreModifier extends ConsumablePokemonModifier {
  private restorePoints: integer;
  private percent: boolean;
  public fainted: boolean;

  constructor(type: ModifierType, pokemonId: integer, restorePoints: integer, percent: boolean, fainted?: boolean) {
    super(type, pokemonId);

    this.restorePoints = restorePoints;
    this.percent = percent;
    this.fainted = !!fainted;
  }

  shouldApply(args: any[]): boolean {
    return super.shouldApply(args) && (this.fainted || (args.length > 1 && typeof(args[1]) === 'number'));
  }

  apply(args: any[]): boolean {
    const pokemon = args[0] as Pokemon;
    if (!pokemon.hp === this.fainted) {
      let restorePoints = this.restorePoints;
      if (!this.fainted)
        restorePoints = Math.floor(restorePoints * (args[1] as number));
      else
        pokemon.resetStatus();
      pokemon.hp = Math.min(pokemon.hp + Math.ceil((this.percent ? (restorePoints * 0.01) * pokemon.getMaxHp() : restorePoints)), pokemon.getMaxHp());
    }

    return true;
  }
}

export class PokemonStatusHealModifier extends ConsumablePokemonModifier {

  constructor(type: ModifierType, pokemonId: integer) {
    super(type, pokemonId);
  }

  apply(args: any[]): boolean {
    const pokemon = args[0] as Pokemon;
    pokemon.resetStatus();

    return true;
  }
}

export abstract class ConsumablePokemonMoveModifier extends ConsumablePokemonModifier {
  public moveIndex: integer;

  constructor(type: ModifierType, pokemonId: integer, moveIndex: integer) {
    super(type, pokemonId);

    this.moveIndex = moveIndex;
  }
}

export class PokemonPpRestoreModifier extends ConsumablePokemonMoveModifier {
  private restorePoints: integer;

  constructor(type: ModifierType, pokemonId: integer, moveIndex: integer, restorePoints: integer) {
    super(type, pokemonId, moveIndex);

    this.restorePoints = restorePoints;
  }

  apply(args: any[]): boolean {
    const pokemon = args[0] as Pokemon;
    const move = pokemon.getMoveset()[this.moveIndex];
    move.ppUsed = this.restorePoints >= -1 ? Math.max(move.ppUsed - this.restorePoints, 0) : 0;

    return true;
  }
}

export class PokemonAllMovePpRestoreModifier extends ConsumablePokemonModifier {
  private restorePoints: integer;

  constructor(type: ModifierType, pokemonId: integer, restorePoints: integer) {
    super(type, pokemonId);

    this.restorePoints = restorePoints;
  }

  apply(args: any[]): boolean {
    const pokemon = args[0] as Pokemon;
    for (let move of pokemon.getMoveset())
      move.ppUsed = this.restorePoints >= -1 ? Math.max(move.ppUsed - this.restorePoints, 0) : 0;

    return true;
  }
}

export class PokemonLevelIncrementModifier extends ConsumablePokemonModifier {
  constructor(type: ModifierType, pokemonId: integer) {
    super(type, pokemonId);
  }

  apply(args: any[]): boolean {
    const pokemon = args[0] as PlayerPokemon;
    const levelCount = new Utils.IntegerHolder(1);
    pokemon.scene.applyModifiers(LevelIncrementBoosterModifier, true, levelCount);

    pokemon.level += levelCount.value;
    if (pokemon.level <= maxExpLevel) {
      pokemon.exp = getLevelTotalExp(pokemon.level, pokemon.species.growthRate);
      pokemon.levelExp = 0;
    }

    pokemon.scene.unshiftPhase(new LevelUpPhase(pokemon.scene, pokemon.scene.getParty().indexOf(pokemon), pokemon.level - 1, pokemon.level));

    return true;
  }
}

export class TmModifier extends ConsumablePokemonModifier {
  constructor(type: ModifierTypes.TmModifierType, pokemonId: integer) {
    super(type, pokemonId);
  }

  apply(args: any[]): boolean {
    const pokemon = args[0] as PlayerPokemon;

    pokemon.scene.unshiftPhase(new LearnMovePhase(pokemon.scene, pokemon.scene.getParty().indexOf(pokemon), (this.type as ModifierTypes.TmModifierType).moveId));

    return true;
  }
}

export class EvolutionItemModifier extends ConsumablePokemonModifier {
  constructor(type: ModifierTypes.EvolutionItemModifierType, pokemonId: integer) {
    super(type, pokemonId);
  }

  apply(args: any[]): boolean {
    const pokemon = args[0] as PlayerPokemon;

    const matchingEvolution = pokemonEvolutions[pokemon.species.speciesId].find(e => e.item === (this.type as ModifierTypes.EvolutionItemModifierType).evolutionItem
      && (!e.condition || e.condition.predicate(pokemon)));

    if (matchingEvolution) {
      pokemon.scene.unshiftPhase(new EvolutionPhase(pokemon.scene, pokemon.scene.getParty().indexOf(pokemon), matchingEvolution, pokemon.level - 1));
      return true;
    }

    return false;
  }
}

export class MultipleParticipantExpBonusModifier extends PersistentModifier {
  constructor(type: ModifierType, stackCount?: integer) {
    super(type, stackCount);
  }

  match(modifier: Modifier): boolean {
    return modifier instanceof MultipleParticipantExpBonusModifier;
  }

  apply(_args: any[]): boolean {
    return true;
  }

  clone(): MultipleParticipantExpBonusModifier {
    return new MultipleParticipantExpBonusModifier(this.type, this.stackCount);
  }

  getMaxStackCount(): integer {
    return 5;
  }
}

export class HealingBoosterModifier extends PersistentModifier {
  private multiplier: number;

  constructor(type: ModifierType, multiplier: number, stackCount?: integer) {
    super(type, stackCount);

    this.multiplier = multiplier;
  }

  match(modifier: Modifier): boolean {
    return modifier instanceof HealingBoosterModifier;
  }

  clone(): HealingBoosterModifier {
    return new HealingBoosterModifier(this.type, this.multiplier, this.stackCount);
  }

  getArgs(): any[] {
    return [ this.multiplier ];
  }

  apply(args: any[]): boolean {
    const healingMultiplier = args[0] as Utils.IntegerHolder;
    for (let s = 0; s < this.getStackCount(); s++)
      healingMultiplier.value *= this.multiplier;
    healingMultiplier.value = Math.floor(healingMultiplier.value);

    return true;
  }

  getmaxStackCount(): integer {
    return 4;
  }
}

export class ExpBoosterModifier extends PersistentModifier {
  private boostMultiplier: integer;

  constructor(type: ModifierType, boostPercent: integer, stackCount?: integer) {
    super(type, stackCount);

    this.boostMultiplier = boostPercent * 0.01;
  }

  match(modifier: Modifier): boolean {
    if (modifier instanceof ExpBoosterModifier) {
      const expModifier = modifier as ExpBoosterModifier;
      return expModifier.boostMultiplier === this.boostMultiplier;
    }
    return false;
  }

  clone(): ExpBoosterModifier {
    return new ExpBoosterModifier(this.type, this.boostMultiplier * 100, this.stackCount);
  }

  getArgs(): any[] {
    return [ this.boostMultiplier * 100 ];
  }

  apply(args: any[]): boolean {
    (args[0] as Utils.NumberHolder).value = Math.floor((args[0] as Utils.NumberHolder).value * (1 + (this.getStackCount() * this.boostMultiplier)));

    return true;
  }
}

export class PokemonExpBoosterModifier extends PokemonHeldItemModifier {
  private boostMultiplier: integer;

  constructor(type: ModifierTypes.PokemonExpBoosterModifierType, pokemonId: integer, boostPercent: integer, stackCount?: integer) {
    super(type, pokemonId, stackCount);
    this.boostMultiplier = boostPercent * 0.01;
  }

  matchType(modifier: Modifier): boolean {
    if (modifier instanceof PokemonExpBoosterModifier) {
      const pokemonExpModifier = modifier as PokemonExpBoosterModifier;
      return pokemonExpModifier.boostMultiplier === this.boostMultiplier;
    }
    return false;
  }

  clone(): PersistentModifier {
    return new PokemonExpBoosterModifier(this.type as ModifierTypes.PokemonExpBoosterModifierType, this.pokemonId, this.boostMultiplier * 100, this.stackCount);
  }

  getArgs(): any[] {
    return super.getArgs().concat(this.boostMultiplier * 100);
  }

  shouldApply(args: any[]): boolean {
    return super.shouldApply(args) && args.length === 2 && args[1] instanceof Utils.NumberHolder;
  }

  apply(args: any[]): boolean {
    (args[1] as Utils.NumberHolder).value = Math.floor((args[1] as Utils.NumberHolder).value * (1 + (this.getStackCount() * this.boostMultiplier)));

    return true;
  }
}

export class ExpShareModifier extends PersistentModifier {
  constructor(type: ModifierType, stackCount?: integer) {
    super(type, stackCount);
  }

  match(modifier: Modifier): boolean {
    return modifier instanceof ExpShareModifier;
  }

  apply(_args: any[]): boolean {
    return true;
  }

  clone(): ExpShareModifier {
    return new ExpShareModifier(this.type, this.stackCount);
  }

  getMaxStackCount(): integer {
    return 5;
  }
}

export class ExpBalanceModifier extends PersistentModifier {
  constructor(type: ModifierType, stackCount?: integer) {
    super(type, stackCount);
  }

  match(modifier: Modifier): boolean {
    return modifier instanceof ExpBalanceModifier;
  }

  apply(_args: any[]): boolean {
    return true;
  }

  clone(): ExpBalanceModifier {
    return new ExpBalanceModifier(this.type, this.stackCount);
  }

  getMaxStackCount(): integer {
    return 1;
  }
}

export class ShinyRateBoosterModifier extends PersistentModifier {
  constructor(type: ModifierType, stackCount?: integer) {
    super(type, stackCount);
  }

  match(modifier: Modifier): boolean {
    return modifier instanceof ShinyRateBoosterModifier;
  }

  clone(): ShinyRateBoosterModifier {
    return new ShinyRateBoosterModifier(this.type, this.stackCount);
  }

  apply(args: any[]): boolean {
    (args[0] as Utils.IntegerHolder).value = Math.pow((args[0] as Utils.IntegerHolder).value * 0.5, this.getStackCount() + 1);

    return true;
  }

  getMaxStackCount(): integer {
    return 4;
  }
}

export class SwitchEffectTransferModifier extends PokemonHeldItemModifier {
  constructor(type: ModifierType, pokemonId: integer, stackCount?: integer) {
    super(type, pokemonId, stackCount);
  }

  matchType(modifier: Modifier): boolean {
    return modifier instanceof SwitchEffectTransferModifier;
  }

  clone(): SwitchEffectTransferModifier {
    return new SwitchEffectTransferModifier(this.type, this.pokemonId, this.stackCount);
  }

  apply(args: any[]): boolean {
    return true;
  }

  getMaxStackCount(): integer {
    return 1;
  }
}

export abstract class HeldItemTransferModifier extends PokemonHeldItemModifier {
  constructor(type: ModifierType, pokemonId: integer, stackCount?: integer) {
    super(type, pokemonId, stackCount);
  }

  apply(args: any[]): boolean {
    const pokemon = args[0] as Pokemon;
    const targetPokemon = pokemon.getOpponent(args.length > 1 ? args[1] as integer : !pokemon.scene.currentBattle.double ? 0 : Utils.randInt(2));
    if (!targetPokemon)
      return false;

    const transferredItemCount = this.getTransferredItemCount();
    if (!transferredItemCount)
      return false;

    const transferredModifierTypes: ModifierTypes.ModifierType[] = [];
    const itemModifiers = pokemon.scene.findModifiers(m => m instanceof PokemonHeldItemModifier
        && (m as PokemonHeldItemModifier).pokemonId === targetPokemon.id && !m.matchType(this), targetPokemon.isPlayer()) as PokemonHeldItemModifier[];
    
    for (let i = 0; i < transferredItemCount; i++) {
      if (!itemModifiers.length)
        break;
      const randItemIndex = Utils.randInt(itemModifiers.length);
      const randItem = itemModifiers[randItemIndex];
      if (pokemon.scene.tryTransferHeldItemModifier(randItem, pokemon, false, false)) {
        transferredModifierTypes.push(randItem.type);
        itemModifiers.splice(randItemIndex, 1);
      }
    }

    for (let mt of transferredModifierTypes)
      pokemon.scene.queueMessage(this.getTransferMessage(pokemon, targetPokemon, mt));

    return !!transferredModifierTypes.length;
  }

  abstract getTransferredItemCount(): integer

  abstract getTransferMessage(pokemon: Pokemon, targetPokemon: Pokemon, item: ModifierTypes.ModifierType): string
}

export class TurnHeldItemTransferModifier extends HeldItemTransferModifier {
  constructor(type: ModifierType, pokemonId: integer, stackCount?: integer) {
    super(type, pokemonId, stackCount);
  }

  matchType(modifier: Modifier): boolean {
    return modifier instanceof TurnHeldItemTransferModifier;
  }

  clone(): TurnHeldItemTransferModifier {
    return new TurnHeldItemTransferModifier(this.type, this.pokemonId, this.stackCount);
  }

  getTransferredItemCount(): integer {
    return this.getStackCount();
  }

  getTransferMessage(pokemon: Pokemon, targetPokemon: Pokemon, item: ModifierTypes.ModifierType): string {
    return getPokemonMessage(targetPokemon, `'s ${item.name} was absorbed\nby ${pokemon.name}'s ${this.type.name}!`);
  }

  getMaxStackCount(): integer {
    return 3;
  }
}

export class ContactHeldItemTransferChanceModifier extends HeldItemTransferModifier {
  private chance: number;

  constructor(type: ModifierType, pokemonId: integer, chancePercent: integer, stackCount?: integer) {
    super(type, pokemonId, stackCount);

    this.chance = chancePercent / 100;
  }

  matchType(modifier: Modifier): boolean {
    return modifier instanceof ContactHeldItemTransferChanceModifier;
  }

  clone(): ContactHeldItemTransferChanceModifier {
    return new ContactHeldItemTransferChanceModifier(this.type, this.pokemonId, this.chance * 100, this.stackCount);
  }

  getArgs(): any[] {
    return super.getArgs().concat(this.chance * 100);
  }

  getTransferredItemCount(): integer {
    return Math.random() < (this.chance * this.getStackCount()) ? 1 : 0;
  }

  getTransferMessage(pokemon: Pokemon, targetPokemon: Pokemon, item: ModifierTypes.ModifierType): string {
    return getPokemonMessage(targetPokemon, `'s ${item.name} was snatched\nby ${pokemon.name}'s ${this.type.name}!`);
  }

  getmaxStackCount(): integer {
    return 5;
  }
}

export class ExtraModifierModifier extends PersistentModifier {
  constructor(type: ModifierType, stackCount?: integer) {
    super(type, stackCount);
  }

  match(modifier: Modifier): boolean {
    return modifier instanceof ExtraModifierModifier;
  }

  clone(): ExtraModifierModifier {
    return new ExtraModifierModifier(this.type, this.stackCount);
  }

  apply(args: any[]): boolean {
    (args[0] as Utils.IntegerHolder).value += this.getStackCount();

    return true;
  }

  getMaxStackCount(): integer {
    return 3;
  }
}