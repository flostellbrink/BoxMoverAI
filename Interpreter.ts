import {AmbiguityError} from "./AmbiguityError";
import {World, WorldState} from "./World";

import {
    Clarification,
    Command,
    Conjunction, DNFFormula, DropCommand, Entity,
    Literal, Location,
    MoveCommand, Object, Relation, RelativeObject,
    ShrdliteResult, SimpleObject, TakeCommand,
} from "./Types";

import * as util from "./lib/typescript-collections/src/lib/util";

/*
 * Interpreter
 *
 * The goal of the Interpreter module is to interpret a sentence
 * written by the user in the context of the current world state.
 * In particular, it must figure out which objects in the world,
 * i.e. which elements in the 'objects' field of WorldState, correspond
 * to the ones referred to in the sentence.
 *
 * Moreover, it has to derive what the intended goal state is and
 * return it as a logical formula described in terms of literals, where
 * each literal represents a relation among objects that should
 * hold. For example, assuming a world state where "a" is a ball and
 * "b" is a table, the command "put the ball on the table" can be
 * interpreted as the literal ontop(a,b). More complex goals can be
 * written using conjunctions and disjunctions of these literals.
 *
 * In general, the module can take a list of possible parses and return
 * a list of possible interpretations, but the code to handle this has
 * already been written for you. The only part you need to implement is
 * the core interpretation function, namely 'interpretCommand', which
 * produces a single interpretation for a single command.
 *
 * You should implement the function 'interpretCommand'.
 */

/**
 * Top-level function for the Interpreter.
 * It calls 'interpretCommand' for each possible parse of the command.
 * You don't have to change this function.
 * @param parses: List of parses produced by the Parser.
 * @param clarifications: Clarifications to resolve ambiguities
 * @param world: The current state of the world.
 * @returns: List of interpretation results, which are the parse results augmented
 *           with interpretations. Each interpretation is represented by a DNFFormula.
 *           If there's an interpretation error, it throws an error with a string description.
 */
export function interpret(
    parses: ShrdliteResult[],
    clarifications: Clarification[][],
    world: WorldState): ShrdliteResult[] {
    // Make a copy of clarifications
    clarifications = clarifications.slice();

    const errors: Error[] = [];
    const interpretations: ShrdliteResult[] = [];
    const possibleParses: ShrdliteResult[] = [];
    const interpreter: Interpreter = new Interpreter(world);

    for (const parse of parses) {
        console.log(parse);
        try {
            const intp: DNFFormula = interpreter.interpretCommand(parse.parse, []);
            possibleParses.push(parse);
            parse.interpretation = intp;
            interpretations.push(parse);
        } catch (err) {
            if (err instanceof AmbiguityError) {
                possibleParses.push(parse);
            }
            errors.push(err);
        }
    }

    if (possibleParses.length === 0) {
        // merge all errors into one
        throw errors.join(" ; ");
    }

    let ambiguousObjects: Array<{parse: ShrdliteResult, entity: Entity}> = [];
    for (const parse of possibleParses) {
        if (parse.parse instanceof MoveCommand) {
            ambiguousObjects.push({parse, entity: parse.parse.entity});
        } else if (parse.parse instanceof TakeCommand) {
            ambiguousObjects.push({parse, entity: parse.parse.entity});
        } else if (parse.parse instanceof DropCommand) {
            // There cannot be any ambiguities in drops
        } else {
            throw Error(`Unexpected ambiguity in ${parse}`);
        }
    }

    while (ambiguousObjects.length > 1 && clarifications.length > 0) {
        const clarification = clarifications.splice(0, 1)[0];
        ambiguousObjects = ambiguousObjects.filter((object) =>
            clarification.some((clar) =>
                isObjectMatch((clar as Clarification).entity.object, object.entity.object)));
    }

    if (ambiguousObjects.length === 0) {
        throw new Error("No interpretation matches your clarifications.");
    }

    if (ambiguousObjects.length <= 1) {
        const result = ambiguousObjects[0].parse;
        result.interpretation = interpreter.interpretCommand(result.parse, clarifications);
        return [result];
    }

    const objectsDescription = ListObjects(ambiguousObjects.map((parse) => parse.entity.object));
    throw new AmbiguityError(`Do you want me to move ${objectsDescription}?`);
}

function isEntityMatch(filter: Entity, entity: Entity): boolean {
    if (entity.quantifier !== filter.quantifier) {
        return false;
    }
    return isObjectMatch(filter.object, entity.object);
}

function isObjectMatch(filter: Object, object: Object): boolean {
    if (filter instanceof SimpleObject) {
        object = GetSimple(object);
        if (filter.form !== "anyform" && object.form !== filter.form) {
            return false;
        }
        if (filter.color !== null && object.color !== filter.color) {
            return false;
        }
        if (filter.size !== null && object.size !== filter.size) {
            return false;
        }
        return true;
    } else {
        if (filter.location.relation === "at any location") {
            if (object instanceof RelativeObject) {
                return false;
            }
            return isObjectMatch(filter.object, object);
        }
        if (object instanceof SimpleObject) {
            return false;
        }
        return isLocationMatch(filter.location, object.location) && isObjectMatch(filter.object, object.object);
    }
}

function isLocationMatch(filter: Location, location: Location) : boolean {
    if (location.relation !== filter.relation) {
        return false;
    }
    return isEntityMatch(filter.entity, location.entity);
}

// By Form
function ListObjects(objects: Object[]): string {
    if (objects.length === 0) {
        throw new Error("Objects cannot be empty");
    }
    const grouped = GroupBy(objects, (object) => GetSimple(object).form);
    const keys = Object.keys(grouped);
    const terms = keys.map((key) => `${ListObjectsByColor((grouped as any)[key], key === "anyform" ? "object" : key)}`);
    const result = StringOrJoin(terms);

    if (keys.length === 1 && result === "the " + keys[0]) {
        throw new AmbiguityError(`Found similar objects. Please describe your ${keys[0]}.`);
    }
    return result;
}

function ListObjectsByColor(objects: Object[], description: string): string {
    if (objects.length === 0) {
        throw new Error("Objects cannot be empty");
    }
    const grouped = GroupBy(objects, (object) => GetSimple(object).color);
    const keys = Object.keys(grouped);
    if (keys.length === 1) {
        return ListObjectsBySize((grouped as any)[keys[0]], description);
    }
    const terms = keys.map((key) =>
        ListObjectsBySize((grouped as any)[key],
            `${key === "undefined" ? "any color" : key} ${description}`));
    return ` ${StringOrJoin(terms)}`;
}

function ListObjectsBySize(objects: Object[], description: string): string {
    if (objects.length === 0) {
        throw new Error("Objects cannot be empty");
    }
    const grouped = GroupBy(objects, (object) => GetSimple(object).size);
    const keys = Object.keys(grouped);
    if (keys.length === 1) {
        return `the ${ListObjectsByLocation((grouped as any)[keys[0]], description)}`;
    }
    const terms = keys.map((key) =>
        ListObjectsByLocation((grouped as any)[key], key === "undefined" ? "any size" : key));
    return ` the ${StringOrJoin(terms)} ${description}`;
}

function ListObjectsByLocation(objects: Object[], description: string): string {
    if (objects.length === 0) {
        throw new Error("Objects cannot be empty");
    }
    const grouped = GroupBy(
        objects,
        (object) => object instanceof RelativeObject ? DescribeLocation(object.location) : undefined);
    const keys = Object.keys(grouped);
    if (keys.length === 1) {
        return description;
    }

    const terms = keys.map((key) => key === "undefined" ? "at any location" : key);
    return `${description} ${terms.join(" or the one ")}`;
}

function DescribeLocation(location: Location): string {
    if (location.relation === "at any location") {
        return location.relation;
    }
    if (location.relation === "holding") {
        return "being held";
    }
    return `that is ${location.relation} ${DescribeEntity(location.entity)}`;
}

function DescribeEntity(entity: Entity): string {
    return `${entity.quantifier} ${DescribeObject(entity.object)}`;
}

function DescribeObject(object: Object): string {
    const locations: Location[] = [];
    let relativeObject = object;
    while (relativeObject instanceof RelativeObject) {
        locations.push(relativeObject.location);
        relativeObject = relativeObject.object;
    }
    return `${DescribeSimpleObject(relativeObject)} ${locations.map(DescribeLocation).join(" ")}`;
}

function DescribeSimpleObject(object: SimpleObject): string {
    return (object.size === null ? "" : object.size + " ")
        + (object.color === null ? "" : object.color + " ")
        + (object.form === "anyform" ? "object" : object.form);
}

function StringOrJoin(strings: string[]): string {
    if (strings.length === 1) {
        return strings[0];
    }
    let last = strings.splice(-1, 1)[0];
    last = (strings.length > 1 ? ", or " : " or ") + last;
    return strings.join(", ") + last;
}

function GroupBy<T>(values: T[], key: (value: T) => any) {
    return values.reduce(function(accumulation, next) {
        ((accumulation as any)[key(next)] = (accumulation as any)[key(next)] || []).push(next);
        return accumulation;
    }, {});
}

function GetSimple(object: Object): SimpleObject {
    let obj = object;
    while (obj instanceof RelativeObject) {
        obj = obj.object;
    }
    return obj;
}

/**
 * Interpreter holds a world state and interprets commands based on it.
 * It can read the outputs of the grammar parser and convert them into DNFs for the planner.
 */
class Interpreter {
    constructor(private world: WorldState) {
    }

    /**
     * Floor of world
     */
    public static floor = new SimpleObject("floor", null, null);
    public static floorEntity = new Entity("the", Interpreter.floor);

    public interpretCommand(cmd: Command, clarifications: Clarification[][]): DNFFormula {
        const result = Interpreter.interpretCommandInternal(cmd, clarifications, this.world);

        // Remove all self referencing literals
        const filteredConjunctions: Conjunction[] = [];
        for (const conjunction of result.conjuncts) {
            const filteredDisjunction = conjunction.literals.filter((literal) =>
                (literal.args.length !== 2) || (literal.args[0] !== literal.args[1]));
            if (filteredDisjunction.length > 0) {
                filteredConjunctions.push(new Conjunction(filteredDisjunction));
            }
        }
        result.conjuncts = filteredConjunctions;

        if (result.conjuncts.length === 0) {
            throw new Error("Can not interpret command");
        }
        return result;
    }

    /**
     * The main interpretation method.
     * @param cmd: An object of type 'Command'.
     * @returns: A DNFFormula representing the interpretation of the user's command.
     *           If there's an interpretation error, it throws an error with a string description.
     */
    public static interpretCommandInternal(cmd: Command, clarifications: Clarification[][], world: WorldState)
        : DNFFormula {
        if (cmd instanceof MoveCommand) {
            const entity = Interpreter.interpretEntity(cmd.entity, clarifications, world);
            const location = Interpreter.interpretLocation(cmd.location, clarifications, world);

            if (location.entity.junction === Junction.Conjunction) {
                if (entity.junction === Junction.Conjunction) {
                    // all objects && all locations => 1 big conjunction of all combinations 1 term
                    const conjunction: Literal[] = [];
                    for (const object of entity.objects) {
                        for (const constraint of location.entity.objects) {
                            const args = [Interpreter.getObjectName(object, world),
                                Interpreter.getObjectName(constraint, world)];
                            const literal = new Literal(location.relation, args);
                            if (Interpreter.isLiteralValid(literal, world)) {
                                conjunction.push(literal);
                            }
                        }
                    }
                    return new DNFFormula([new Conjunction(conjunction)]);
                } else {
                    // any objects && all locations
                    // (o1c1 o1c2 o1c3) or (o2c1 o2c2 o2c3) or (o3c1 o3c2 o3c3) n terms
                    const disjunction: Conjunction[] = [];
                    for (const object of entity.objects) {
                        const conjunction: Literal[] = [];
                        for (const constraint of location.entity.objects) {
                            const args = [Interpreter.getObjectName(object, world),
                                Interpreter.getObjectName(constraint, world)];
                            const literal = new Literal(location.relation, args);
                            conjunction.push(literal);
                        }

                        // Only add non-empty conjunctions with valid literals
                        if (conjunction.length > 0
                            && conjunction.every((literal) => Interpreter.isLiteralValid(literal, world))) {
                            disjunction.push(new Conjunction(conjunction));
                        }
                    }
                    return new DNFFormula(disjunction);
                }
            } else {
                if (entity.junction === Junction.Conjunction) {
                    // all objects && any locations => Disjunction(Conjunction(allobjects))
                    // (o1c1 o2c1 o3c1) or (01c1 o2c1 o3c2) .... exponential growth 2^n terms
                    const counter: number[] = new Array(entity.objects.length);
                    for (let i = 0; i < entity.objects.length; ++i) {
                        counter[i] = 0;
                    }

                    const totalCount = location.entity.objects.length ** entity.objects.length;
                    // Iterate over individual conjunctions
                    const disjunction: Conjunction[] = [];
                    for (let i = 0; i < totalCount; ++i) {
                        const conjunction: Literal[] = [];
                        for (let j = 0; j < entity.objects.length; ++j) {
                            const args = [Interpreter.getObjectName(entity.objects[j], world),
                                Interpreter.getObjectName(location.entity.objects[counter[j]], world)];
                            const literal = new Literal(location.relation, args);
                            conjunction.push(literal);
                        }
                        // Only add non-empty conjunctions with valid literals
                        if (conjunction.length > 0
                            && conjunction.every((literal) => Interpreter.isLiteralValid(literal, world))) {
                            disjunction.push(new Conjunction(conjunction));
                        }

                        // Increment counter (base of constraint count)
                        for (let j = entity.objects.length - 1; j >= 0; --j) {
                            counter[j]++;
                            if (counter[j] < location.entity.objects.length) {
                                break;
                            }
                            counter[j] = 0;
                        }
                    }
                    return new DNFFormula(disjunction);
                } else {
                    // any objects && any locations
                    // (o1c1) or (o1c2) or (o1c3) or (o2)... or (o3)... n² terms
                    const disjunction: Conjunction[] = [];
                    for (const object of entity.objects) {
                        for (const constraint of location.entity.objects) {
                            const args = [Interpreter.getObjectName(object, world),
                                Interpreter.getObjectName(constraint, world)];
                            const literal = new Literal(location.relation, args);
                            if (Interpreter.isLiteralValid(literal, world)) {
                                disjunction.push(new Conjunction([literal]));
                            }
                        }
                    }
                    return new DNFFormula(disjunction);
                }
            }
        } else if (cmd instanceof TakeCommand) {
            // We cannot pick up more than one object at a time
            const entity = Interpreter.interpretEntity(cmd.entity, clarifications, world);
            if (entity.junction === Junction.Conjunction && entity.objects.length > 1) {
                return new DNFFormula([]);
            }

            // One conjunction term per object
            const disjunction: Conjunction[] = [];
            for (const objects of entity.objects) {
                const literal = new Literal("holding", [Interpreter.getObjectName(objects, world)]);
                if (Interpreter.isLiteralValid(literal, world)) {
                    disjunction.push(new Conjunction([literal]));
                }
            }
            return new DNFFormula(disjunction);
        } else if (cmd instanceof DropCommand) {
            if (!world.holding) {
                return new DNFFormula([]);
            }

            const location = Interpreter.interpretLocation(cmd.location, clarifications, world);
            if (location.entity.junction === Junction.Conjunction) {
                // One big conjunction term with all constraints
                const conjunction: Literal[] = [];
                for (const constraint of location.entity.objects) {
                    const args = [world.holding, Interpreter.getObjectName(constraint, world)];
                    const literal = new Literal(cmd.location.relation, args);
                    if (Interpreter.isLiteralValid(literal, world)) {
                        conjunction.push(literal);
                    }
                }
                return new DNFFormula([new Conjunction(conjunction)]);
            } else {
                // One conjunction term per constraint
                const disjunction: Conjunction[] = [];
                for (const constraint of location.entity.objects) {
                    const args = [world.holding, Interpreter.getObjectName(constraint, world)];
                    const literal = new Literal(cmd.location.relation, args);
                    if (Interpreter.isLiteralValid(literal, world)) {
                        disjunction.push(new Conjunction([literal]));
                    }
                }
                return new DNFFormula(disjunction);
            }
        }
        throw new Error("Unknown command");
    }

    /**
     * Interpret a location consisting of a relation to an entity
     * @param {Location} location: The location as parsed by the grammar
     * @returns {LocationSemantics} The location to build a DNF from
     */
    public static interpretLocation(location: Location, clarifications: Clarification[][], world: WorldState)
        : LocationSemantics {
        const entity = Interpreter.interpretEntity(location.entity, clarifications, world);
        return {relation: location.relation, entity};
    }

    /**
     * Interpret an entity with relation and object
     * @param {Entity} ent: The entity as parsed by the grammar
     * @returns {EntitySemantics}: The entity to build a DNF from
     */
    public static interpretEntity(ent: Entity, clarifications: Clarification[][], world: WorldState): EntitySemantics {
        switch (ent.quantifier) {
            case "any":
                // Return all possible objects and tell caller to pick any of them
                return {
                    junction: Junction.Disjunction,
                    objects: Interpreter.getObjects(ent.object, clarifications, world)
                };
            case "all":
                // Return all possible object and tell caller to match all of them
                return {
                    junction: Junction.Conjunction,
                    objects: Interpreter.getObjects(ent.object, clarifications, world)
                };
            case "the":
                // Find a single object matching the description and resolve ambiguities
                const result = Interpreter.resolveAmbiguity(
                    Interpreter.getObjects(ent.object, clarifications, world), clarifications, world);
                return {junction: Junction.Conjunction, objects: [result]};
            default:
                throw new Error(`Unknown quantifier: ${ent.quantifier}`);
        }
    }

    /**
     * Get all objects within the world, that match the properties of the filter object
     * @param {Object} filter The object used to filter by
     * @returns {SimpleObject[]} List of all matching simple objects
     */
    public static getObjects(filter: Object, clarifications: Clarification[][], world: WorldState): SimpleObject[] {
        return Interpreter.getSimpleObjects(world).filter((object) =>
            Interpreter.matchObject(filter, object, clarifications, world));
    }

    /**
     * Filter objects by matching the properties of the filter object
     * @param {Object} filter The object used to filter by
     * @returns {SimpleObject[]} List of all matching simple objects
     */
    public static matchObject(filter: Object, object: SimpleObject, clarifications: Clarification[][], world: WorldState): boolean {
        if (filter instanceof SimpleObject) {
            if (filter.form !== "anyform" && object.form !== filter.form) {
                return false;
            }
            if (filter.color !== null && object.color !== filter.color) {
                return false;
            }
            if (filter.size !== null && object.size !== filter.size) {
                return false;
            }
            return true;
        } else {
            const location = Interpreter.interpretLocation(filter.location, clarifications, world);
            return Interpreter.matchLocation(location, object, world)
                && Interpreter.matchObject(filter.object, object, clarifications, world);
        }
    }

    /**
     * Resolve ambiguities between different simple objects
     * @param {SimpleObject[]} objects: Possible objects
     * @returns {SimpleObject} The object desired by the user
     */
    public static resolveAmbiguity(objects: SimpleObject[], clarifications: Clarification[][], world: WorldState)
        : SimpleObject {
        while (objects.length > 1 && clarifications.length > 0) {
            const clarification = clarifications.splice(0, 1)[0];
            objects = objects.filter((object) =>
                clarification.some((clar) => this.matchObject(clar.entity.object, object, clarifications, world)));
        }

        if (objects.length === 0) {
            throw new Error("No objects to choose from");
        }

        if (objects.length === 1) {
            return objects[0];
        }

        const relativeObjects: Object[] = [];
        for (const object of objects) {
            const stackId = Interpreter.getStackId(object, world);
            if (stackId === undefined) {
                relativeObjects.push(new RelativeObject(object, new Location("holding", Interpreter.floorEntity)));
                continue;
            }
            const stackIndex = world.stacks[stackId].indexOf(Interpreter.getObjectName(object, world));
            const belowObject = stackIndex === 0
                ? Interpreter.floor
                : world.objects[world.stacks[stackId][stackIndex - 1]];
            const relation = belowObject.form === "box" ? "inside" : "above";
            relativeObjects.push(new RelativeObject(object, new Location(relation, new Entity("the", belowObject))));
        }
        throw new AmbiguityError(`Did you mean ${ListObjects(relativeObjects)}?`);
    }

    /**
     * Checks if a literal complies with rules
     * @param {Literal} literal: The literal to check
     * @returns {boolean} True if literal is allowed by rules, false otherwise
     */
    public static isLiteralValid(literal: Literal, world: WorldState): boolean {
        // Cannot manipulate the floor
        if (literal.args.length > 0 && literal.args[0] === Interpreter.getObjectName(Interpreter.floor, world)) {
            return false;
        }

        // Check holding & any location separately
        if (literal.relation === "holding" || literal.relation === "at any location") {
            return true;
        }

        // All other relations take two arguments (for now)
        if (literal.args.length !== 2) {
            return false;
        }
        const objectA = Interpreter.getObject(literal.args[0], world);
        const objectB = Interpreter.getObject(literal.args[1], world);
        if (objectA === objectB) {
            return true;
        }

        // Apply rules specific to relations
        switch (literal.relation) {
            case "leftof":
                return true;
            case "rightof":
                return true;
            case "inside":
                if (objectB.form !== "box") {
                    return false;
                }
                if (objectA.size === "large" && objectB.size === "small") {
                    return false;
                }
                if (objectA.form === "pyramid" || objectA.form === "plank" || objectA.form === "box") {
                    if (objectB.size === "small" || objectA.size === "large") {
                        return false;
                    }
                }
                return true;
            case "ontop":
                if (objectB.form === "box" || objectB.form === "ball") {
                    return false;
                }
                if (objectA.form === "ball" && objectB !== Interpreter.floor) {
                    return false;
                }
                if (objectA.size === "large" && objectB.size === "small") {
                    return false;
                }
                if (objectA.form === "box" && objectA.size === "small") {
                    if ((objectB.form === "brick" || objectB.form === "pyramid") && objectB.size === "small") {
                        return false;
                    }
                }
                if (objectA.form === "box" && objectA.size === "large") {
                    if (objectB.form === "pyramid") {
                        return false;
                    }
                }
                return true;
            case "under":
                if (objectA.form === "ball") {
                    return false;
                }
                if (objectA.size === "small" && objectB.size === "large") {
                    return false;
                }
                return true;
            case "beside":
                return true;
            case "above":
                if (objectB.form === "ball") {
                    return false;
                }
                if (objectB.size === "small" && objectA.size === "large") {
                    return false;
                }
                return true;
            default:
                throw new Error(`Unknown relation: ${literal.relation}`);
        }
    }

    /**
     * Get all objects within the world
     * @returns {SimpleObject[]} List of all simple objects
     */
    public static getSimpleObjects(world: WorldState): SimpleObject[] {
        const array: SimpleObject[] = [];
        for (const name in world.objects) {
            if (util.has(world.objects, name)) {
                array.push(world.objects[name]);
            }
        }
        array.push(Interpreter.floor);
        return array;
    }

    /**
     * Dictionary of functions that say if objectA is in a specific relation to objectB
     */
    public static relationTesters: { [relation: string]: RelationTesterFunction; } = {
        leftof: (objectA, stackA, objectB, stackB, world) =>
            stackA !== undefined && stackB !== undefined && stackA < stackB,
        rightof: (objectA, stackA, objectB, stackB, world) =>
            stackA !== undefined && stackB !== undefined && stackA > stackB,
        beside: (objectA, stackA, objectB, stackB, world) =>
            (stackA !== undefined && stackA - 1 === stackB) || (stackB !== undefined && stackA === stackB - 1),
        inside: (objectA, stackA, objectB, stackB, world) =>
            stackA === stackB && stackA !== undefined
            && world.stacks[stackA].indexOf(Interpreter.getObjectName(objectA, world)) - 1
            === world.stacks[stackA].indexOf(Interpreter.getObjectName(objectB, world))
            && objectB.form === "box",
        ontop: (objectA, stackA, objectB, stackB, world) => {
            if (objectB === Interpreter.floor) {
                return stackA !== undefined
                    && world.stacks[stackA].indexOf(Interpreter.getObjectName(objectA, world)) === 0;
            }
            return stackA === stackB && stackA !== undefined
                && world.stacks[stackA].indexOf(Interpreter.getObjectName(objectA, world)) - 1
                === world.stacks[stackA].indexOf(Interpreter.getObjectName(objectB, world))
                && objectB.form !== "box";
        },
        under: (objectA, stackA, objectB, stackB, world) =>
            stackA === stackB && stackA !== undefined
            && world.stacks[stackA].indexOf(Interpreter.getObjectName(objectA, world)) <
            world.stacks[stackA].indexOf(Interpreter.getObjectName(objectB, world)),
        above: (objectA, stackA, objectB, stackB, world) => {
            if (objectB === Interpreter.floor) {
                return true;
            }
            return stackA === stackB && stackA !== undefined
                && world.stacks[stackA].indexOf(Interpreter.getObjectName(objectA, world)) >
                world.stacks[stackA].indexOf(Interpreter.getObjectName(objectB, world));
        }
    };

    /**
     * Interpret a location consisting of a relation to an entity
     * @param {SimpleObject[]} objects: Objects to filter by location
     * @param {Location} filter: The location as parsed by the grammar
     * @returns {LocationSemantics} The objects that are in the described location
     */
    public static matchLocation(filter: LocationSemantics, object: SimpleObject, world: WorldState): boolean {
        const relationTester = (objectA: SimpleObject, objectB: SimpleObject): boolean => {
            if (filter.relation === "at any location") {
                return true;
            }
            if (objectA === objectB) {
                return true;
            }
            const stackA = Interpreter.getStackId(objectA, world);
            if (filter.relation === "holding") {
                return stackA === undefined;
            }
            const stackB = Interpreter.getStackId(objectB, world);
            if ((stackA === undefined && objectA !== Interpreter.floor)
                || (stackB === undefined && objectB !== Interpreter.floor)) {
                return false;
            }
            return Interpreter.relationTesters[filter.relation](objectA, stackA, objectB, stackB, world);
        };

        return filter.entity.junction === Junction.Conjunction
            ? filter.entity.objects.every((locationObject) => relationTester(object, locationObject))
            : filter.entity.objects.some((locationObject) => relationTester(object, locationObject));
    }

    /**
     * Lookup an objects name in the world
     * @param {SimpleObject} obj: The object to look up
     * @returns {string} The name given to the object in the world
     */
    public static getObjectName(obj: SimpleObject, world: WorldState): string {
        if (obj === Interpreter.floor) {
            return "floor";
        }
        for (const name in world.objects) {
            if (util.has(world.objects, name)) {
                if (world.objects[name] === obj) {
                    return name;
                }
            }
        }
        throw new Error("Could not find object");
    }

    /**
     * Lookup an objects by its name in the world
     * @param {SimpleObject} name: The name of the object to look up
     * @returns {string} The object matching the name
     */
    public static getObject(name: string, world: WorldState): SimpleObject {
        if (name === "floor") {
            return Interpreter.floor;
        }
        return world.objects[name];
    }

    /**
     * Get number of stack containing object
     * @param {SimpleObject} object: Object to get stack for
     * @returns {number | undefined} The identifier of the stack containing object
     * or undefined if no stack contains object
     */
    public static getStackId(object: SimpleObject, world: WorldState): number | undefined {
        const stacks = world.stacks
            .filter((stack) => stack.some((obj) => Interpreter.getObject(obj, world) === object));

        if (stacks.length === 0) {
            return undefined;
        }
        return world.stacks.indexOf(stacks[0]);
    }
}

// Type of junction for building the DNF
enum Junction { Disjunction, Conjunction}

// Semantics of an entity, describing all objects they (might) refer to
interface EntitySemantics {
    junction: Junction;
    objects: SimpleObject[];
}

// Semantics of a location, contains a relation to an entity
interface LocationSemantics {
    relation: Relation;
    entity: EntitySemantics;
}

type RelationTesterFunction = (
    objectA: SimpleObject,
    stackA: number | undefined,
    objectB: SimpleObject,
    stackB: number | undefined,
    world: WorldState) => boolean;
