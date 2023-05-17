import BattleScene, { PokeballCounts } from "./battle-scene";
import { EnemyPokemon, PlayerPokemon, QueuedMove } from "./pokemon";
import { Command } from "./ui/command-ui-handler";
import * as Utils from "./utils";

export enum BattlerIndex {
    PLAYER,
    PLAYER_2,
    ENEMY,
    ENEMY_2
}

export interface TurnCommand {
    command: Command;
    cursor?: integer;
    move?: QueuedMove;
    targets?: BattlerIndex[];
    args?: any[];
};

interface TurnCommands {
    [key: integer]: TurnCommand
}

export default class Battle {
    public waveIndex: integer;
    public enemyLevels: integer[];
    public enemyField: EnemyPokemon[];
    public double: boolean;
    public turn: integer;
    public turnCommands: TurnCommands;
    public turnPokeballCounts: PokeballCounts;
    public playerParticipantIds: Set<integer> = new Set<integer>();
    public escapeAttempts: integer = 0;

    constructor(waveIndex: integer, double: boolean) {
        this.waveIndex = waveIndex;
        this.enemyLevels = new Array(double ? 2 : 1).fill(null).map(() => this.getLevelForWave());
        this.enemyField = [];
        this.double = double;
        this.turn = 0;
    }

    private getLevelForWave(): number {
        let baseLevel = 1 + this.waveIndex / 2 + Math.pow(this.waveIndex / 25, 2);

        if (!(this.waveIndex % 10)) {
            if (this.waveIndex === 200)
                return 200;
            return Math.floor(baseLevel * 1.2);
        }

        const deviation = 10 / this.waveIndex;

        return Math.max(Math.round(baseLevel + Math.abs(Utils.randGauss(deviation))), 1);
    }

    getBattlerCount(): integer {
        return this.double ? 2 : 1;
    }

    incrementTurn(scene: BattleScene): void {
        this.turn++;
        this.turnCommands = Object.fromEntries(Utils.getEnumValues(BattlerIndex).map(bt => [ bt, null ]));
        this.turnPokeballCounts = Object.assign({}, scene.pokeballCounts);
    }

    addParticipant(playerPokemon: PlayerPokemon): void {
        this.playerParticipantIds.add(playerPokemon.id);
    }

    removeFaintedParticipant(playerPokemon: PlayerPokemon): void {
        this.playerParticipantIds.delete(playerPokemon.id);
    }
}