const resultado = nota => nota >= 7 ? ' Aprovado!!! ' : ' Reprovado '// O operador ternario usa uma relação de valor verdade,
                                      // SE VERDADEIRO    SE FALSO      seguido das possibilidades de resposta que o operador relacional disponibiliza

console.log(resultado(7.1))
console.log(resultado(76.7))
console.log(resultado(6.7))

/* FUNÇÃO COM CORPO
    const resultado = nota => {
        return nota >= 7 ? ' Aprovado!!! ' : ' Reprovado '
    }
*/