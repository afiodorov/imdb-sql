import type {Field, FullOption, RuleType} from 'react-querybuilder';
import {defaultOperators, toFullOption} from 'react-querybuilder';
import {languages, regions, types} from './options';

export const validator = (r: RuleType) => !!r.value;

interface OperatorOption extends FullOption<string> {
    name: string;
}

const operatorOptions = defaultOperators as OperatorOption[];

export const fields = (
    [
        {
            name: 'titleId',
            label: 'IMDB ID (primary key)',
            placeholder: 'Enter IMDB titleId',
            validator,
        },
        {
            name: 'title',
            label: 'Regional Title',
            placeholder: 'Localised (translated) title',
            defaultOperator: 'contains',
            validator,
        },
        {
            name: 'region',
            label: 'Region',
            valueEditorType: 'select',
            values: regions,
            defaultValue: 'US',
            defaultOperator: 'null',
            operators: operatorOptions.filter((op) => op.name === '=' || op.name === 'null' || op.name === '!=' || op.name === 'notNull'),
        },
        {
            name: 'language',
            label: 'Language',
            valueEditorType: 'select',
            values: languages,
            operators: operatorOptions.filter((op) => op.name === '=' || op.name === 'null' || op.name === '!=' || op.name === 'notNull'),
        },
        {
            name: 'averageRating',
            label: 'Rating',
            defaultOperator: '>=',
            inputType: 'number',
        },
        {
            name: 'numVotes',
            label: 'Number of votes',
            defaultOperator: '>=',
            inputType: 'number',
        },
        {
            name: 'startYear',
            label: 'Year released',
            defaultOperator: '>=',
            inputType: 'number',
        },
        {
            name: 'genres',
            label: 'Genres',
            placeholder: 'Drama',
            defaultOperator: 'contains',
            validator,
        },
        {
            name: 'primaryTitle',
            label: 'Original title',
            placeholder: 'Original title',
            defaultOperator: 'contains',
        },
        {
            name: 'titleType',
            label: 'Type of media',
            valueEditorType: 'select',
            values: types,
            operators: operatorOptions.filter((op) => op.name === '='),
        },] satisfies Field[]
).map((o) => toFullOption(o));
