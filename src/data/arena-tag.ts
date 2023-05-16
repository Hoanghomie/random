import { Arena } from "../arena";
import { Type } from "./type";
import * as Utils from "../utils";
import { Moves, allMoves } from "./move";
import { getPokemonMessage } from "../messages";
import Pokemon, { DamageResult, HitResult, MoveResult } from "../pokemon";
import { DamagePhase, ObtainStatusEffectPhase } from "../battle-phases";
import { StatusEffect } from "./status-effect";
import { BattlerTagType } from "./battler-tag";

export enum ArenaTagType {
  NONE,
  MUD_SPORT,
  WATER_SPORT,
  SPIKES,
  TOXIC_SPIKES,
  STEALTH_ROCK,
  TRICK_ROOM,
  GRAVITY
}

export abstract class ArenaTag {
  public tagType: ArenaTagType;
  public turnCount: integer;
  public sourceMove: Moves;
  public sourceId: integer;

  constructor(tagType: ArenaTagType, turnCount: integer, sourceMove: Moves, sourceId?: integer) {
    this.tagType = tagType;
    this.turnCount = turnCount;
    this.sourceMove = sourceMove;
    this.sourceId = sourceId;
  }

  apply(args: any[]): boolean { 
    return true;
  }

  onAdd(arena: Arena): void { }

  onRemove(arena: Arena): void {
    arena.scene.queueMessage(`${this.getMoveName()}\'s effect wore off.`);
  }

  onOverlap(arena: Arena): void { }

  lapse(arena: Arena): boolean {
    return this.turnCount < 1 || !!(--this.turnCount);
  }

  getMoveName(): string {
    return this.sourceMove
      ? allMoves[this.sourceMove].name
      : null;
  }
}

export class WeakenMoveTypeTag extends ArenaTag {
  private weakenedType: Type;

  constructor(tagType: ArenaTagType, turnCount: integer, type: Type, sourceMove: Moves, sourceId: integer) {
    super(tagType, turnCount, sourceMove, sourceId);

    this.weakenedType = type;
  }

  apply(args: any[]): boolean {
    if ((args[0] as Type) === this.weakenedType) {
      (args[1] as Utils.NumberHolder).value *= 0.33;
      return true;
    }

    return false;
  }
}

class MudSportTag extends WeakenMoveTypeTag {
  constructor(turnCount: integer, sourceId: integer) {
    super(ArenaTagType.MUD_SPORT, turnCount, Type.ELECTRIC, Moves.MUD_SPORT, sourceId);
  }

  onAdd(arena: Arena): void {
    arena.scene.queueMessage('Electricity\'s power was weakened!');
  }

  onRemove(arena: Arena): void {
    arena.scene.queueMessage('The effects of MUD SPORT\nhave faded.');
  }
}

class WaterSportTag extends WeakenMoveTypeTag {
  constructor(turnCount: integer, sourceId: integer) {
    super(ArenaTagType.WATER_SPORT, turnCount, Type.FIRE, Moves.WATER_SPORT, sourceId);
  }

  onAdd(arena: Arena): void {
    arena.scene.queueMessage('Fire\'s power was weakened!');
  }

  onRemove(arena: Arena): void {
    arena.scene.queueMessage('The effects of WATER SPORT\nhave faded.');
  }
}

export class ArenaTrapTag extends ArenaTag {
  public layers: integer;
  public maxLayers: integer;

  constructor(tagType: ArenaTagType, sourceMove: Moves, sourceId: integer, maxLayers: integer) {
    super(tagType, 0, sourceMove, sourceId);

    this.layers = 1;
    this.maxLayers = maxLayers;
  }

  onOverlap(arena: Arena): void {
    if (this.layers < this.maxLayers) {
      this.layers++;

      this.onAdd(arena);
    }
  }

  apply(args: any[]): boolean { 
    const pokemon = args[0] as Pokemon;
    if (this.sourceId === pokemon.id || pokemon.scene.getPokemonById(this.sourceId).isPlayer() === pokemon.isPlayer())
      return false;

    return this.activateTrap(pokemon);
  }

  activateTrap(pokemon: Pokemon): boolean {
    return false;
  }
}

class SpikesTag extends ArenaTrapTag {
  constructor(sourceId: integer) {
    super(ArenaTagType.SPIKES, Moves.SPIKES, sourceId, 3);
  }

  onAdd(arena: Arena): void {
    super.onAdd(arena);

    const source = arena.scene.getPokemonById(this.sourceId);
    arena.scene.queueMessage(`${this.getMoveName()} were scattered\nall around ${source.getOpponentDescriptor()}'s feet!`);
  }

  activateTrap(pokemon: Pokemon): boolean {
    if ((!pokemon.isOfType(Type.FLYING) || pokemon.getTag(BattlerTagType.IGNORE_FLYING) || pokemon.scene.arena.getTag(ArenaTagType.GRAVITY))) {
      const damageHpRatio = 1 / (10 - 2 * this.layers);

      pokemon.scene.queueMessage(getPokemonMessage(pokemon, ' is hurt\nby the spikes!'));
      pokemon.scene.unshiftPhase(new DamagePhase(pokemon.scene, pokemon.getBattlerIndex(), HitResult.OTHER));
      pokemon.damage(Math.ceil(pokemon.getMaxHp() * damageHpRatio));
      return true;
    }

    return false;
  }
}

class ToxicSpikesTag extends ArenaTrapTag {
  constructor(sourceId: integer) {
    super(ArenaTagType.TOXIC_SPIKES, Moves.TOXIC_SPIKES, sourceId, 2);
  }

  onAdd(arena: Arena): void {
    super.onAdd(arena);
    
    const source = arena.scene.getPokemonById(this.sourceId);
    arena.scene.queueMessage(`${this.getMoveName()} were scattered\nall around ${source.getOpponentDescriptor()}'s feet!`);
  }

  activateTrap(pokemon: Pokemon): boolean {
    if (!pokemon.status && (!pokemon.isOfType(Type.FLYING) || pokemon.getTag(BattlerTagType.IGNORE_FLYING) || pokemon.scene.arena.getTag(ArenaTagType.GRAVITY))) {
      const toxic = this.layers > 1;

      pokemon.scene.unshiftPhase(new ObtainStatusEffectPhase(pokemon.scene, pokemon.getBattlerIndex(),
        !toxic ? StatusEffect.POISON : StatusEffect.TOXIC, null, `the ${this.getMoveName()}`));
      return true;
    }

    return false;
  }
}

class StealthRockTag extends ArenaTrapTag {
  constructor(sourceId: integer) {
    super(ArenaTagType.STEALTH_ROCK, Moves.STEALTH_ROCK, sourceId, 1);
  }

  onAdd(arena: Arena): void {
    super.onAdd(arena);

    const source = arena.scene.getPokemonById(this.sourceId);
    arena.scene.queueMessage(`Pointed stones float in the air\naround ${source.getOpponentDescriptor()}!`);
  }

  activateTrap(pokemon: Pokemon): boolean {
    const effectiveness = pokemon.getAttackMoveEffectiveness(Type.ROCK);

    let damageHpRatio: number;

    switch (effectiveness) {
      case 0:
        damageHpRatio = 0;
        break;
      case 0.25:
        damageHpRatio = 0.03125;
        break;
      case 0.5:
        damageHpRatio = 0.0625;
        break;
      case 1:
        damageHpRatio = 0.125;
        break;
      case 2:
        damageHpRatio = 0.25;
        break;
      case 4:
        damageHpRatio = 0.5;
        break;
    }

    if (damageHpRatio) {
      pokemon.scene.queueMessage(`Pointed stones dug into\n${pokemon.name}!`);
      pokemon.scene.unshiftPhase(new DamagePhase(pokemon.scene, pokemon.getBattlerIndex(), HitResult.OTHER));
      pokemon.damage(Math.ceil(pokemon.getMaxHp() * damageHpRatio));
    }

    return false;
  }
}

export class TrickRoomTag extends ArenaTag {
  constructor(turnCount: integer, sourceId: integer) {
    super(ArenaTagType.TRICK_ROOM, turnCount, Moves.TRICK_ROOM, sourceId);
  }

  apply(args: any[]): boolean {
    const speedReversed = args[0] as Utils.BooleanHolder;
    speedReversed.value = !speedReversed.value;
    return true;
  }

  onAdd(arena: Arena): void {
    arena.scene.queueMessage(getPokemonMessage(arena.scene.getPokemonById(this.sourceId), ' twisted\nthe dimensions!'));
  }

  onRemove(arena: Arena): void {
    arena.scene.queueMessage('The twisted dimensions\nreturned to normal!');
  }
}

export class GravityTag extends ArenaTag {
  constructor(turnCount: integer) {
    super(ArenaTagType.GRAVITY, turnCount, Moves.GRAVITY);
  }

  onAdd(arena: Arena): void {
    arena.scene.queueMessage('Gravity intensified!');
  }

  onRemove(arena: Arena): void {
    arena.scene.queueMessage('Gravity returned to normal!');
  }
}

export function getArenaTag(tagType: ArenaTagType, turnCount: integer, sourceMove: Moves, sourceId: integer): ArenaTag {
  switch (tagType) {
    case ArenaTagType.MUD_SPORT:
      return new MudSportTag(turnCount, sourceId);
    case ArenaTagType.WATER_SPORT:
      return new WaterSportTag(turnCount, sourceId);
    case ArenaTagType.SPIKES:
      return new SpikesTag(sourceId);
    case ArenaTagType.TOXIC_SPIKES:
      return new ToxicSpikesTag(sourceId);
    case ArenaTagType.STEALTH_ROCK:
      return new StealthRockTag(sourceId);
    case ArenaTagType.TRICK_ROOM:
      return new TrickRoomTag(turnCount, sourceId);
    case ArenaTagType.GRAVITY:
      return new GravityTag(turnCount);
  }
}