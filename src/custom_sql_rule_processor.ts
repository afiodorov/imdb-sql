import {defaultRuleProcessorSQL, RuleProcessor} from 'react-querybuilder'

export const customRuleProcessor: RuleProcessor = (rule, options) => {
    const caseInsensitiveOperators = [
        'contains',
        'beginsWith',
        'endsWith',
        'doesNotContain',
        'doesNotBeginWith',
        'doesNotEndWith'
    ];

    if (caseInsensitiveOperators.includes(rule.operator)) {
        switch (rule.operator) {
            case 'contains':
                return `upper(${rule.field}) like upper('%${rule.value}%')`;
            case 'beginsWith':
                return `upper(${rule.field}) like upper('${rule.value}%')`;
            case 'endsWith':
                return `upper(${rule.field}) like upper('%${rule.value}')`;
            case 'doesNotContain':
                return `upper(${rule.field}) not like upper('%${rule.value}%')`;
            case 'doesNotBeginWith':
                return `upper(${rule.field}) not like upper('${rule.value}%')`;
            case 'doesNotEndWith':
                return `upper(${rule.field}) not like upper('%${rule.value}')`;
        }
    }
    return defaultRuleProcessorSQL(rule, options);
};
