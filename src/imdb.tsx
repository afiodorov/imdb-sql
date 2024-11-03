export interface LinkProps {
    titleId: string;
}

export const ImdbLink: React.FC<LinkProps> = ({titleId}) => <a
    href={`https://www.imdb.com/title/${titleId}/`}
    target="_blank"
    rel="noopener noreferrer"
>
    {titleId}
</a>
