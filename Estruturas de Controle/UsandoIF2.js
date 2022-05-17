function teste1(num) {
    if (num > 7) {
        console.log(num)
        console.log('Final')    
    }
}

teste1(6)
teste1(8)

function teste2 (num) {
    if (num > 7); { // Ira rodar o trecho depois do if pois o if ira parar a partir do (;), e executara o outro bloco normalmente, independente do if
        console.log(num)
    }
}
teste2(6)
teste2(8)